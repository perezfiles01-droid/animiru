/**
 * The JavaScript that runs *inside* the sandbox before an extension does.
 *
 * This is a source string rather than a module because it is evaluated in
 * the vm realm, not this one. Its job is to turn the two raw host callables
 * the sandbox is seeded with into a comfortable API - the one Mangayomi
 * sources are written against - and then remove every reference to those
 * callables from anywhere an extension can see.
 *
 * The rules it exists to enforce:
 *
 *   - No host object is ever handed to extension code. Host calls take and
 *     return JSON strings; everything an extension touches is built here,
 *     in its own realm, from those strings.
 *   - No host promise either. An awaited host promise would expose the host
 *     Promise constructor, and from a constructor you can reach a Function
 *     constructor, and from there the host realm. Async results are adopted
 *     into a local promise instead.
 *   - No host Error. Rejections and throws are re-created locally from their
 *     message text for the same reason.
 */

const RUNTIME_SOURCE = `
(function bootstrapExtensionRuntime(hostSync, hostAsync) {
  'use strict';

  var stringify = JSON.stringify;
  var parse = JSON.parse;

  // Errors that cross the boundary are re-thrown as locals; the host object
  // itself must never escape into extension code.
  function localError(err) {
    var message;
    try {
      message = err && err.message ? String(err.message) : String(err);
    } catch (e) {
      message = 'Extension host error';
    }
    return new Error(message);
  }

  function sync(name, args) {
    var raw;
    try {
      raw = hostSync(name, stringify(args || []));
    } catch (err) {
      throw localError(err);
    }
    return parse(String(raw));
  }

  function callAsync(name, args) {
    return new Promise(function (resolve, reject) {
      var pending;
      try {
        pending = hostAsync(name, stringify(args || []));
      } catch (err) {
        reject(localError(err));
        return;
      }
      // Adopting via then() rather than awaiting keeps the host promise out
      // of extension reach - what resolves below is this local promise.
      pending.then(
        function (raw) {
          try {
            resolve(parse(String(raw)));
          } catch (err) {
            reject(localError(err));
          }
        },
        function (err) { reject(localError(err)); }
      );
    });
  }

  /**
   * One selected node. Handles are opaque integers owned by the host; this
   * class is the only thing that knows what to do with them.
   */
  function Element(handle) {
    this._handle = handle;
  }

  Element.prototype.select = function (selector) {
    return sync('html.select', [this._handle, selector]).map(function (h) {
      return new Element(h);
    });
  };
  Element.prototype.selectFirst = function (selector) {
    var handle = sync('html.selectFirst', [this._handle, selector]);
    return handle === null ? null : new Element(handle);
  };
  Element.prototype.attr = function (name) { return sync('html.attr', [this._handle, name]); };
  Element.prototype.attrs = function () { return sync('html.attrs', [this._handle]); };
  Element.prototype.text = function () { return sync('html.text', [this._handle]); };
  Element.prototype.html = function () { return sync('html.html', [this._handle]); };
  Element.prototype.outerHtml = function () { return sync('html.outerHtml', [this._handle]); };
  Element.prototype.children = function () {
    return sync('html.children', [this._handle]).map(function (h) { return new Element(h); });
  };
  Element.prototype.parent = function () {
    var handle = sync('html.parent', [this._handle]);
    return handle === null ? null : new Element(handle);
  };
  Element.prototype.tagName = function () { return sync('html.tagName', [this._handle]); };

  // Jsoup-flavoured aliases, because that is what sources written for
  // Mangayomi reach for.
  Element.prototype.getHref = function () { return this.attr('href'); };
  Element.prototype.getSrc = function () { return this.attr('src'); };

  function Document(html) {
    Element.call(this, sync('html.parse', [html]));
  }
  Document.prototype = Object.create(Element.prototype);
  Document.prototype.constructor = Document;

  function parseFragment(html) {
    return new Element(sync('html.parseFragment', [html]));
  }

  /**
   * Extension-facing HTTP. Every method funnels into one host op so the
   * host-side caps apply uniformly.
   */
  var client = {
    request: function (options) {
      var opts = options || {};
      return callAsync('http.request', [{
        url: opts.url,
        method: opts.method || 'GET',
        headers: opts.headers || {},
        body: opts.body
      }]);
    },
    get: function (url, headers) {
      return client.request({ url: url, method: 'GET', headers: headers });
    },
    post: function (url, headers, body) {
      return client.request({ url: url, method: 'POST', headers: headers, body: body });
    },
    head: function (url, headers) {
      return client.request({ url: url, method: 'HEAD', headers: headers });
    }
  };

  var base64 = {
    encode: function (value) { return sync('base64.encode', [value]); },
    decode: function (value) { return sync('base64.decode', [value]); }
  };

  var cryptoApi = {
    md5: function (data) { return sync('crypto.hash', ['md5', data]); },
    sha1: function (data) { return sync('crypto.hash', ['sha1', data]); },
    sha256: function (data) { return sync('crypto.hash', ['sha256', data]); },
    sha512: function (data) { return sync('crypto.hash', ['sha512', data]); },
    hmac: function (algorithm, key, data) { return sync('crypto.hmac', [algorithm, key, data]); },
    randomHex: function (bytes) { return sync('crypto.randomHex', [bytes]); },
    aesDecrypt: function (payloadBase64, keyHex, ivHex) {
      return sync('crypto.aesDecrypt', [payloadBase64, keyHex, ivHex]);
    }
  };

  var preferences = {
    get: function (key) { return sync('pref.get', [key]); },
    all: function () { return sync('pref.all', []); }
  };

  function log(level) {
    return function () {
      var parts = [];
      for (var i = 0; i < arguments.length; i += 1) {
        var value = arguments[i];
        if (typeof value === 'string') {
          parts.push(value);
        } else {
          try {
            parts.push(stringify(value));
          } catch (err) {
            parts.push(String(value));
          }
        }
      }
      sync('log', [level, parts.join(' ')]);
    };
  }

  /**
   * The base class Mangayomi sources extend. It carries nothing an
   * extension cannot already reach; it exists so that sources written
   * elsewhere load here unmodified.
   */
  function MProvider(source) {
    this.source = source || {};
  }
  MProvider.prototype.getPreference = function (key) { return preferences.get(key); };
  MProvider.prototype.getBaseUrl = function () {
    return this.source.baseUrl || preferences.get('baseUrl');
  };
  MProvider.prototype.getHeaders = function (url) {
    return { Referer: this.source.baseUrl || url || '' };
  };
  MProvider.prototype.getSourcePreferences = function () { return []; };

  globalThis.MProvider = MProvider;
  globalThis.Element = Element;
  globalThis.Document = Document;
  globalThis.parseFragment = parseFragment;
  globalThis.client = client;
  globalThis.base64Encode = base64.encode;
  globalThis.base64Decode = base64.decode;
  globalThis.base64 = base64;
  globalThis.crypto = cryptoApi;
  globalThis.preferences = preferences;
  globalThis.console = {
    log: log('log'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
    debug: log('debug')
  };

  // The seeded host callables are captured in the closures above and are now
  // unreachable by name. This is the line that closes the door.
  delete globalThis.__hostSync;
  delete globalThis.__hostAsync;
})(globalThis.__hostSync, globalThis.__hostAsync);
`;

module.exports = { RUNTIME_SOURCE };
