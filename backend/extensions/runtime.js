/**
 * The JavaScript that runs *inside* the sandbox before an extension does.
 *
 * This is a source string rather than a module because it is evaluated in
 * the vm realm, not this one. Its job is to turn the two raw host callables
 * the sandbox is seeded with into the API Mangayomi sources are written
 * against, and then remove every reference to those callables.
 *
 * The API here is not invented. It follows Mangayomi's CONTRIBUTING-JS.md
 * and the usage in its published sources, because the whole point is that a
 * source written for that app runs here unmodified. Two details in
 * particular are easy to get wrong and fatal when wrong:
 *
 *   - `Client` and `SharedPreferences` are classes a source instantiates
 *     (`new Client().get(url)`), not globals it calls. Providing a global
 *     named `client` instead produces "Client is not defined" on the first
 *     line of almost every real source.
 *   - On a DOM node, only `select`, `selectFirst` and `attr` are methods.
 *     `text`, `innerHtml`, `getHref`, `getSrc` and the rest are properties.
 *     Making them methods returns a function where a string was expected,
 *     which fails later and further away, in parsing rather than access.
 *
 * The rules the bootstrap exists to enforce:
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
  Element.prototype.getAttribute = function (name) { return this.attr(name); };

  /**
   * Everything below is a property, not a method, because that is how
   * sources use it: \`el.selectFirst("h1").text\`, never \`.text()\`.
   */
  function defineGetter(name, read) {
    Object.defineProperty(Element.prototype, name, { get: read, configurable: true });
  }

  defineGetter('text', function () { return sync('html.text', [this._handle]); });
  defineGetter('innerHtml', function () { return sync('html.html', [this._handle]); });
  defineGetter('html', function () { return sync('html.html', [this._handle]); });
  defineGetter('outerHtml', function () { return sync('html.outerHtml', [this._handle]); });
  defineGetter('getHref', function () { return this.attr('href'); });
  defineGetter('getSrc', function () { return this.attr('src'); });
  defineGetter('getDst', function () { return this.attr('data-src'); });
  defineGetter('id', function () { return this.attr('id'); });
  defineGetter('className', function () { return this.attr('class'); });
  defineGetter('tagName', function () { return sync('html.tagName', [this._handle]); });

  defineGetter('children', function () {
    return sync('html.children', [this._handle]).map(function (h) { return new Element(h); });
  });
  defineGetter('parent', function () {
    var handle = sync('html.parent', [this._handle]);
    return handle === null ? null : new Element(handle);
  });
  defineGetter('nextElementSibling', function () {
    var handle = sync('html.nextElementSibling', [this._handle]);
    return handle === null ? null : new Element(handle);
  });
  defineGetter('previousElementSibling', function () {
    var handle = sync('html.previousElementSibling', [this._handle]);
    return handle === null ? null : new Element(handle);
  });

  function Document(html) {
    Element.call(this, sync('html.parse', [html]));
  }
  Document.prototype = Object.create(Element.prototype);
  Document.prototype.constructor = Document;

  /**
   * What a Client call resolves to. \`body\` is what sources read; the rest
   * is there for the ones that check a status before parsing.
   */
  function Response(raw) {
    this.body = raw.body;
    this.statusCode = raw.statusCode;
    this.headers = raw.headers;
    this.url = raw.url;
  }

  /**
   * HTTP. Instantiated per call in real sources - \`new Client().get(url)\` -
   * so the constructor takes nothing and holds no state.
   */
  function Client() {}

  Client.prototype.request = function (options) {
    var opts = options || {};
    var headers = {};
    for (var h in (opts.headers || {})) {
      if (Object.prototype.hasOwnProperty.call(opts.headers, h)) headers[h] = opts.headers[h];
    }
    return callAsync('http.request', [{
      url: opts.url,
      method: opts.method || 'GET',
      headers: headers,
      body: encodeBody(opts.body, headers)
    }]).then(function (raw) { return new Response(raw); });
  };
  Client.prototype.get = function (url, headers) {
    return this.request({ url: url, method: 'GET', headers: headers });
  };
  Client.prototype.post = function (url, headers, body) {
    return this.request({ url: url, method: 'POST', headers: headers, body: body });
  };
  Client.prototype.head = function (url, headers) {
    return this.request({ url: url, method: 'HEAD', headers: headers });
  };

  /**
   * Turns an object body into the bytes the server is being told to expect.
   *
   * A source may hand over an object and say what it is:
   *
   *     this.client.post(url, { "Content-Type": "application/json" }, { query: q })
   *
   * Form-encoding that regardless - as this did - sends a GraphQL API a
   * body it cannot parse. It answers with an error rather than a failure,
   * so the source's own try/catch swallows it and the user sees an empty
   * list instead of a problem: "Miruro returned no titles".
   *
   * With no Content-Type the body is form-encoded, which is what Dart's
   * http client does for a Map and therefore what Mangayomi sources that
   * omit the header are written against. The header is filled in to match,
   * so the server is never told one thing and sent another.
   *
   * @param body    whatever the source passed
   * @param headers mutated in place when a Content-Type has to be added
   */
  function encodeBody(body, headers) {
    if (body === null || body === undefined) return body;
    if (typeof body !== 'object') return body;

    var declared = '';
    for (var key in headers) {
      if (Object.prototype.hasOwnProperty.call(headers, key) &&
          String(key).toLowerCase() === 'content-type') {
        declared = String(headers[key] || '').toLowerCase();
        break;
      }
    }

    if (declared.indexOf('json') >= 0) return JSON.stringify(body);
    if (declared) return formEncode(body);

    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    return formEncode(body);
  }

  function formEncode(data) {
    var parts = [];
    for (var key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(data[key]));
      }
    }
    return parts.join('&');
  }

  /** This source's settings, read the way Mangayomi sources read them. */
  function SharedPreferences() {}
  SharedPreferences.prototype.get = function (key) { return sync('pref.get', [key]); };
  SharedPreferences.prototype.getString = function (key) { return sync('pref.get', [key]); };
  SharedPreferences.prototype.setString = function () {
    // Settings are the user's, edited in the app; a source may read them
    // but must not rewrite them behind the user's back.
    throw new Error('A source cannot change preferences');
  };

  /**
   * The base class Mangayomi sources extend.
   */
  function MProvider(source) {
    this.source = source || {};
  }
  MProvider.prototype.getPreference = function (key) { return sync('pref.get', [key]); };
  MProvider.prototype.getBaseUrl = function () {
    return this.source.baseUrl || sync('pref.get', ['baseUrl']);
  };
  MProvider.prototype.getHeaders = function (url) {
    return { Referer: this.source.baseUrl || url || '' };
  };
  MProvider.prototype.getSourcePreferences = function () { return []; };
  MProvider.prototype.getFilterList = function () { return []; };

  /**
   * The string helpers Mangayomi documents. They are on String.prototype
   * because sources call them on strings directly.
   */
  function defineStringMethod(name, fn) {
    Object.defineProperty(String.prototype, name, {
      value: fn, writable: true, configurable: true, enumerable: false
    });
  }

  defineStringMethod('substringAfter', function (pattern) {
    var index = this.indexOf(pattern);
    return index === -1 ? String(this) : this.slice(index + pattern.length);
  });
  defineStringMethod('substringAfterLast', function (pattern) {
    var index = this.lastIndexOf(pattern);
    return index === -1 ? String(this) : this.slice(index + pattern.length);
  });
  defineStringMethod('substringBefore', function (pattern) {
    var index = this.indexOf(pattern);
    return index === -1 ? String(this) : this.slice(0, index);
  });
  defineStringMethod('substringBeforeLast', function (pattern) {
    var index = this.lastIndexOf(pattern);
    return index === -1 ? String(this) : this.slice(0, index);
  });
  defineStringMethod('substringBetween', function (left, right) {
    var start = this.indexOf(left);
    if (start === -1) return '';
    var from = start + left.length;
    var end = this.indexOf(right, from);
    return end === -1 ? '' : this.slice(from, end);
  });

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

  globalThis.Element = Element;
  globalThis.Document = Document;
  globalThis.Client = Client;
  globalThis.Response = Response;
  globalThis.SharedPreferences = SharedPreferences;
  globalThis.MProvider = MProvider;

  // Used by the driver, not by sources: hands the host the defaults a
  // source declared so pref.get can fall back to them.
  globalThis.__declarePreferenceDefaults = function (declared) {
    sync('pref.declareDefaults', [declared || []]);
  };

  globalThis.base64Encode = base64.encode;
  globalThis.base64Decode = base64.decode;
  globalThis.base64 = base64;
  globalThis.crypto = cryptoApi;

  // Mangayomi's crypto utilities, as bare globals, which is how sources
  // call them.
  globalThis.cryptoHandler = function (text, iv, key, encrypt) {
    return sync('crypto.cryptoHandler', [text, iv, key, Boolean(encrypt)]);
  };
  globalThis.encryptAESCryptoJS = function (plainText, passphrase) {
    return sync('crypto.encryptAESCryptoJS', [plainText, passphrase]);
  };
  globalThis.decryptAESCryptoJS = function (encrypted, passphrase) {
    return sync('crypto.decryptAESCryptoJS', [encrypted, passphrase]);
  };
  globalThis.unpackJs = function (code) {
    return sync('crypto.unpackJs', [code]);
  };
  globalThis.deobfuscateJsPassword = function () {
    // Deliberately absent rather than approximated: guessing at what this
    // returns would produce a wrong string a source then parses, which is
    // far harder to diagnose than a missing function.
    throw new Error('deobfuscateJsPassword is not implemented in Animiru');
  };

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
