/**
 * The complete list of things an extension can ask the host to do.
 *
 * Everything the sandbox can reach is reachable through exactly two host
 * functions - one synchronous, one asynchronous - dispatching on a name in
 * these two tables. Anything not named here does not exist as far as an
 * extension is concerned, which makes the trust boundary something you can
 * read in one screen rather than infer from what happens to be in scope.
 */

const crypto = require('crypto');
const { HtmlStore } = require('./html');
const http = require('./http');
const { createHandoffStore, isRefusal, DeviceFetchRequired } = require('./handoff');

const MAX_LOG_ENTRIES = 200;
const MAX_LOG_LENGTH = 2000;
const MAX_REQUESTS_PER_RUN = 60;

const HASH_ALGORITHMS = new Set(['md5', 'sha1', 'sha256', 'sha512']);

/**
 * OpenSSL's EVP_BytesToKey with MD5 and one iteration.
 *
 * CryptoJS derives its key and IV this way when given a passphrase, so
 * anything encrypted in a browser by CryptoJS can only be read by deriving
 * them identically.
 */
function evpBytesToKey(passphrase, salt) {
  const password = Buffer.from(passphrase, 'utf8');
  const blocks = [];
  let digest = Buffer.alloc(0);

  // 48 bytes: a 32 byte key followed by a 16 byte IV.
  while (Buffer.concat(blocks).length < 48) {
    digest = crypto.createHash('md5')
      .update(Buffer.concat([digest, password, salt]))
      .digest();
    blocks.push(digest);
  }

  const material = Buffer.concat(blocks);
  return { key: material.subarray(0, 32), iv: material.subarray(32, 48) };
}

/**
 * Reverses Dean Edwards' packer, the `eval(function(p,a,c,k,e,d){...})`
 * wrapper video hosts favour.
 *
 * The payload is a template whose tokens are base-N indices into a word
 * list, so unpacking is substitution: decode each token, look it up, put it
 * back. No evaluation, which is the point - the sandbox has code generation
 * disabled and this must work without it.
 */
function unpackJs(code) {
  const header = code.match(
    /}\s*\(\s*'(.*?)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'(.*?)'\.split\('\|'\)/s
  );
  if (!header) {
    throw new Error('Not a packed script (no packer payload found)');
  }

  const [, payload, radixText, countText, wordsText] = header;
  const radix = Number(radixText);
  const words = wordsText.split('|');

  /** The packer's own base-N encoding: 0-9, a-z, A-Z, then recursive. */
  function toBase(value) {
    const low = value % radix;
    const high = Math.floor(value / radix);
    const digit = low < 10
      ? String(low)
      : String.fromCharCode(low + (low < 36 ? 87 : 29));
    return high === 0 ? digit : toBase(high) + digit;
  }

  const lookup = {};
  for (let index = Number(countText) - 1; index >= 0; index -= 1) {
    const token = toBase(index);
    // A word left empty means the token stands for itself.
    lookup[token] = words[index] || token;
  }

  return payload
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\')
    .replace(/\b\w+\b/g, (token) => (
      Object.prototype.hasOwnProperty.call(lookup, token) ? lookup[token] : token
    ));
}

/**
 * Builds the op tables for a single extension call.
 *
 * @param {Object} options
 * @param {Object} [options.preferences] values the user set for this source
 * @param {number} [options.timeoutMs] wall-clock budget for one HTTP request
 * @returns {{sync:Function, async:Function, logs:Array, requests:Array, dispose:Function}}
 */
/**
 * Reads the default value out of each entry of a getSourcePreferences()
 * array, in the shapes Mangayomi defines.
 *
 * @param {Array} declared
 * @returns {Object} key -> default value
 */
function defaultsFrom(declared) {
  const defaults = {};
  if (!Array.isArray(declared)) return defaults;

  for (const item of declared) {
    if (!item || typeof item !== 'object') continue;
    const key = String(item.key ?? '');
    if (!key) continue;

    const list = item.listPreference;
    if (list && Array.isArray(list.entryValues)) {
      const index = Number(list.valueIndex);
      const value = list.entryValues[Number.isInteger(index) ? index : 0];
      if (value !== undefined) defaults[key] = value;
      continue;
    }

    const multi = item.multiSelectListPreference;
    if (multi && Array.isArray(multi.values)) {
      // An array, not a string: sources index into it.
      defaults[key] = multi.values.slice();
      continue;
    }

    // Mangayomi spells a boolean two ways and sources use both.
    const toggle = item.switchPreferenceCompat || item.checkBoxPreference;
    if (toggle && toggle.value !== undefined) {
      // Read back as the string the app stores, which is what sources
      // compare against: `pref === "true"`.
      defaults[key] = String(!!toggle.value);
      continue;
    }

    const text = item.editTextPreference;
    if (text && text.value !== undefined) defaults[key] = text.value;
  }

  return defaults;
}

function createOps({ preferences = {}, timeoutMs, fetched, allowHandoff = false } = {}) {
  const htmlStore = new HtmlStore();
  // Responses the device already fetched on this run's behalf, from an
  // earlier attempt that the site refused.
  const handoff = createHandoffStore(fetched);
  /** Filled in from the source's own getSourcePreferences(). */
  const declaredDefaults = {};
  const logs = [];
  const requests = [];
  /**
   * The request the device has to make, once one has been refused.
   *
   * Recorded here as well as thrown, because a source is free to catch the
   * error and carry on - several do, falling back to another server - and a
   * run that continued past a refusal would return half a result rather than
   * asking for the one thing that would have completed it.
   */
  let pendingHandoff = null;

  const syncOps = {
    'html.parse': (html) => htmlStore.parse(html),
    'html.parseFragment': (html) => htmlStore.parseFragment(html),
    'html.select': (handle, selector) => htmlStore.select(handle, selector),
    'html.selectFirst': (handle, selector) => htmlStore.selectFirst(handle, selector),
    'html.attr': (handle, name) => htmlStore.attr(handle, name),
    'html.attrs': (handle) => htmlStore.attrs(handle),
    'html.text': (handle) => htmlStore.text(handle),
    'html.html': (handle) => htmlStore.html(handle),
    'html.outerHtml': (handle) => htmlStore.outerHtml(handle),
    'html.parent': (handle) => htmlStore.parent(handle),
    'html.children': (handle) => htmlStore.children(handle),
    'html.tagName': (handle) => htmlStore.tagName(handle),
    'html.nextElementSibling': (handle) => htmlStore.nextElementSibling(handle),
    'html.previousElementSibling': (handle) => htmlStore.previousElementSibling(handle),

    'base64.encode': (input) => Buffer.from(String(input), 'utf8').toString('base64'),
    'base64.decode': (input) => Buffer.from(String(input), 'base64').toString('utf8'),

    'crypto.hash': (algorithm, data) => {
      const algo = String(algorithm).toLowerCase();
      if (!HASH_ALGORITHMS.has(algo)) throw new Error(`Unsupported hash: ${algorithm}`);
      return crypto.createHash(algo).update(String(data), 'utf8').digest('hex');
    },
    'crypto.hmac': (algorithm, key, data) => {
      const algo = String(algorithm).toLowerCase();
      if (!HASH_ALGORITHMS.has(algo)) throw new Error(`Unsupported hash: ${algorithm}`);
      return crypto.createHmac(algo, String(key)).update(String(data), 'utf8').digest('hex');
    },
    'crypto.randomHex': (bytes) => {
      const count = Math.min(Math.max(Number(bytes) || 16, 1), 64);
      return crypto.randomBytes(count).toString('hex');
    },
    /**
     * AES-CBC decryption with a base64 payload, as used by most of the video
     * hosts that hide their manifest URLs behind an obfuscated blob.
     */
    'crypto.aesDecrypt': (payloadBase64, keyHex, ivHex) => {
      const key = Buffer.from(String(keyHex), 'hex');
      const iv = Buffer.from(String(ivHex), 'hex');
      const bits = key.length * 8;
      if (bits !== 128 && bits !== 192 && bits !== 256) {
        throw new Error(`Unsupported AES key length: ${bits} bits`);
      }
      const decipher = crypto.createDecipheriv(`aes-${bits}-cbc`, key, iv);
      return Buffer.concat([
        decipher.update(Buffer.from(String(payloadBase64), 'base64')),
        decipher.final()
      ]).toString('utf8');
    },

    /**
     * AES-CBC with an explicit key and IV, both UTF-8, over base64.
     *
     * This is Mangayomi's `cryptoHandler`, which several sources use to read
     * an obfuscated payload - the key and IV arrive as ordinary strings
     * rather than hex, so they are taken as UTF-8 bytes exactly as written.
     */
    'crypto.cryptoHandler': (text, iv, key, encrypt) => {
      const keyBuffer = Buffer.from(String(key), 'utf8');
      const ivBuffer = Buffer.from(String(iv), 'utf8');
      const bits = keyBuffer.length * 8;
      if (bits !== 128 && bits !== 192 && bits !== 256) {
        throw new Error(`cryptoHandler needs a 16, 24 or 32 character key, got ${keyBuffer.length}`);
      }
      const algorithm = `aes-${bits}-cbc`;

      if (encrypt) {
        const cipher = crypto.createCipheriv(algorithm, keyBuffer, ivBuffer);
        return Buffer.concat([
          cipher.update(String(text), 'utf8'),
          cipher.final()
        ]).toString('base64');
      }

      const decipher = crypto.createDecipheriv(algorithm, keyBuffer, ivBuffer);
      return Buffer.concat([
        decipher.update(Buffer.from(String(text), 'base64')),
        decipher.final()
      ]).toString('utf8');
    },

    /**
     * CryptoJS's passphrase format, which is OpenSSL's: the output is
     * base64 of "Salted__", an eight byte salt, then the ciphertext, and
     * the key and IV are derived from passphrase and salt by EVP_BytesToKey
     * with MD5. Sources encrypted by CryptoJS in a browser expect exactly
     * this, so it has to be reproduced rather than approximated.
     */
    'crypto.encryptAESCryptoJS': (plainText, passphrase) => {
      const salt = crypto.randomBytes(8);
      const { key, iv } = evpBytesToKey(String(passphrase), salt);
      const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
      const body = Buffer.concat([
        cipher.update(String(plainText), 'utf8'),
        cipher.final()
      ]);
      return Buffer.concat([Buffer.from('Salted__', 'utf8'), salt, body]).toString('base64');
    },

    'crypto.decryptAESCryptoJS': (encrypted, passphrase) => {
      const raw = Buffer.from(String(encrypted), 'base64');
      if (raw.length < 16 || raw.subarray(0, 8).toString('utf8') !== 'Salted__') {
        throw new Error('Not a CryptoJS passphrase payload (no Salted__ header)');
      }
      const salt = raw.subarray(8, 16);
      const { key, iv } = evpBytesToKey(String(passphrase), salt);
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      return Buffer.concat([
        decipher.update(raw.subarray(16)),
        decipher.final()
      ]).toString('utf8');
    },

    /**
     * Unpacks a p.a.c.k.e.r-obfuscated script.
     *
     * Video hosts wrap their manifest URL in this constantly. It is done by
     * substitution here rather than by evaluating the payload, because code
     * generation is disabled in the sandbox and re-enabling it to read an
     * obfuscated string would trade the boundary for a convenience.
     */
    'crypto.unpackJs': (code) => unpackJs(String(code)),

    'pref.get': (key) => {
      const name = String(key);
      const value = preferences[name];
      if (value !== undefined) return value;
      // A setting the user has never opened still has a value: the one the
      // source declared in getSourcePreferences(). Returning null instead
      // sends sources down branches they were never meant to take - a
      // server chooser picking no server, a subtitle switch reading as off
      // - so the app looks broken on a fresh install.
      const fallback = declaredDefaults[name];
      return fallback === undefined ? null : fallback;
    },
    'pref.all': () => ({ ...declaredDefaults, ...preferences }),

    /**
     * Records the defaults a source declares, so pref.get can fall back to
     * them. Called by the driver once, before the requested method runs.
     */
    'pref.declareDefaults': (values) => {
      Object.assign(declaredDefaults, defaultsFrom(values));
      return null;
    },

    log: (level, message) => {
      if (logs.length < MAX_LOG_ENTRIES) {
        logs.push({
          level: String(level),
          message: String(message).slice(0, MAX_LOG_LENGTH),
          at: Date.now()
        });
      }
      return null;
    }
  };

  const asyncOps = {
    'http.request': async (options) => {
      if (requests.length >= MAX_REQUESTS_PER_RUN) {
        throw new Error(`Extension exceeded ${MAX_REQUESTS_PER_RUN} requests in one call`);
      }

      const started = Date.now();

      // Recorded before the request is made, not from a callback the
      // transport happens to invoke. What the source asked for is worth
      // knowing even when the request never leaves - a refused address, a
      // bad URL - and a trace that depends on the transport cooperating is
      // empty in exactly the cases worth diagnosing.
      const entry = {
        method: String((options && options.method) || 'GET').toUpperCase(),
        url: options && options.url ? String(options.url) : '',
        startedAt: started
      };
      requests.push(entry);

      // An answer the device already fetched for this exact request, because
      // the site refused the server on an earlier attempt. Returned without
      // touching the network: asking again would be refused again.
      const already = handoff.get({ ...options, method: entry.method });
      if (already) {
        entry.status = already.statusCode;
        entry.durationMs = Date.now() - started;
        entry.bytes = already.body.length;
        entry.viaDevice = true;
        return already;
      }

      try {
        const response = await http.request({
          ...options,
          timeoutMs,
          // Redirects are followed hop by hop, so the URL that finally
          // answered is more useful than the one first asked for.
          onRequest: (hop) => { entry.url = hop.url; }
        });

        entry.status = response.statusCode;
        entry.durationMs = Date.now() - started;
        entry.bytes = response.body.length;

        // A refusal is about who is asking, not what was asked for, so the
        // run stops here and the device is asked to make this one request.
        // Only when the caller can actually do that: on the web there is no
        // device to hand it to, and a refusal is just a refusal.
        if (allowHandoff && isRefusal(response)) {
          entry.handedOff = true;
          // The URL the source asked for, not `entry.url` - which the
          // transport has by now rewritten to whichever hop finally
          // answered. The replay looks this request up by what the source
          // asks for, so naming a redirect target here would file the
          // device's answer under a key the next run never asks about, and
          // the same request would be refused every round until the app
          // gave up and showed the refusal to the user. The device follows
          // the redirects itself, exactly as the server just did.
          const required = new DeviceFetchRequired({
            method: entry.method,
            url: String(options.url),
            headers: options.headers || {},
            body: options.body
          }, response.statusCode);

          if (!pendingHandoff) pendingHandoff = required;
          throw required;
        }

        return response;
      } catch (err) {
        entry.error = err.message;
        entry.durationMs = Date.now() - started;
        throw err;
      }
    }
  };

  /**
   * Dispatches one op. Arguments and results cross the boundary as JSON
   * strings so that neither side ever holds a reference to an object from
   * the other realm.
   */
  function call(table, name, argsJson) {
    const op = table[String(name)];
    if (!op) throw new Error(`Unknown operation: ${name}`);
    const args = argsJson ? JSON.parse(String(argsJson)) : [];
    return op(...args);
  }

  return {
    sync(name, argsJson) {
      return JSON.stringify(call(syncOps, name, argsJson) ?? null);
    },
    async async(name, argsJson) {
      const result = await call(asyncOps, name, argsJson);
      return JSON.stringify(result ?? null);
    },
    logs,
    requests,
    /** Set once a request has been refused; read by the sandbox after the run. */
    get pendingHandoff() {
      return pendingHandoff;
    },
    dispose() {
      htmlStore.dispose();
    }
  };
}

module.exports = { createOps, defaultsFrom, MAX_REQUESTS_PER_RUN, MAX_LOG_ENTRIES };
