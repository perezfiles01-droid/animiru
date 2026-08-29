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

const MAX_LOG_ENTRIES = 200;
const MAX_LOG_LENGTH = 2000;
const MAX_REQUESTS_PER_RUN = 60;

const HASH_ALGORITHMS = new Set(['md5', 'sha1', 'sha256', 'sha512']);

/**
 * Builds the op tables for a single extension call.
 *
 * @param {Object} options
 * @param {Object} [options.preferences] values the user set for this source
 * @param {number} [options.timeoutMs] wall-clock budget for one HTTP request
 * @returns {{sync:Function, async:Function, logs:Array, requests:Array, dispose:Function}}
 */
function createOps({ preferences = {}, timeoutMs } = {}) {
  const htmlStore = new HtmlStore();
  const logs = [];
  const requests = [];

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

    'pref.get': (key) => {
      const value = preferences[String(key)];
      return value === undefined ? null : value;
    },
    'pref.all': () => ({ ...preferences }),

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
      let logged = null;

      try {
        const response = await http.request({
          ...options,
          timeoutMs,
          onRequest: (hop) => {
            if (!logged) {
              logged = { ...hop, startedAt: started };
              requests.push(logged);
            }
          }
        });
        if (logged) {
          logged.status = response.statusCode;
          logged.durationMs = Date.now() - started;
          logged.bytes = response.body.length;
        }
        return response;
      } catch (err) {
        if (logged) {
          logged.error = err.message;
          logged.durationMs = Date.now() - started;
        } else {
          requests.push({
            method: String(options && options.method ? options.method : 'GET').toUpperCase(),
            url: options && options.url ? String(options.url) : '',
            error: err.message,
            startedAt: started,
            durationMs: Date.now() - started
          });
        }
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
    dispose() {
      htmlStore.dispose();
    }
  };
}

module.exports = { createOps, MAX_REQUESTS_PER_RUN, MAX_LOG_ENTRIES };
