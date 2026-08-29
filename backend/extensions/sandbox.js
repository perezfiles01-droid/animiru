/**
 * Runs one extension method and returns its result.
 *
 * ## What this is, and what it is not
 *
 * This is an isolation layer, not a security boundary. `node:vm` gives an
 * extension a fresh realm - no require, no process, no Buffer, nothing from
 * this module's scope - and the runtime bootstrap makes sure no host object,
 * promise or error ever reaches extension code. That is enough to contain
 * mistakes and casual mischief.
 *
 * It is not enough to contain a determined attacker. The vm shares this
 * process's heap, and `timeout` only interrupts synchronous execution: code
 * that spins after its first `await` runs in a microtask this module cannot
 * preempt, and will hold the event loop. Sources you wrote or read are fine.
 * Arbitrary third-party repositories are not, and the plan is to move this
 * runner to a separate host with real isolation before those are promoted.
 */

const vm = require('vm');
const { createOps } = require('./ops');
const { RUNTIME_SOURCE } = require('./runtime');

const DEFAULT_TIMEOUT_MS = 20000;
const MAX_TIMEOUT_MS = 60000;
const MAX_SOURCE_BYTES = 512 * 1024;
const MAX_RESULT_BYTES = 4 * 1024 * 1024;
const SYNC_SLICE_MS = 5000;

/** Methods an extension is allowed to expose. Anything else is not callable. */
const CALLABLE_METHODS = new Set([
  'getPopular',
  'getLatestUpdates',
  'search',
  'getDetail',
  'getVideoList',
  'getPageList',
  'getSourcePreferences'
]);

class ExtensionError extends Error {
  constructor(message, { logs = [], requests = [] } = {}) {
    super(message);
    this.name = 'ExtensionError';
    this.logs = logs;
    this.requests = requests;
  }
}

/**
 * Creates a realm seeded with nothing but the two host callables, then runs
 * the bootstrap that turns them into the extension API and removes them.
 */
function createSandbox(ops) {
  const context = vm.createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false }
  });

  context.__hostSync = (name, argsJson) => ops.sync(name, argsJson);
  context.__hostAsync = (name, argsJson) => ops.async(name, argsJson);

  vm.runInContext(RUNTIME_SOURCE, context, {
    filename: 'animiru:runtime',
    timeout: SYNC_SLICE_MS
  });

  return context;
}

/**
 * Reads the `mangayomiSources` declaration out of a source file.
 *
 * This is deliberately a real evaluation rather than a regex: the array is
 * ordinary JavaScript and some sources compute parts of it. Running it in
 * the same sandbox as everything else keeps that safe.
 */
function extractMetadata(code, { timeoutMs } = {}) {
  const ops = createOps({});
  try {
    const context = createSandbox(ops);
    vm.runInContext(String(code), context, {
      filename: 'animiru:extension',
      timeout: Math.min(Number(timeoutMs) || SYNC_SLICE_MS, MAX_TIMEOUT_MS)
    });
    const json = vm.runInContext(
      'typeof mangayomiSources !== "undefined" ? JSON.stringify(mangayomiSources) : "null"',
      context,
      { filename: 'animiru:metadata', timeout: SYNC_SLICE_MS }
    );
    const parsed = JSON.parse(String(json));
    if (parsed === null) return [];
    return Array.isArray(parsed) ? parsed : [parsed];
  } finally {
    ops.dispose();
  }
}

/**
 * Runs `method` on the extension defined by `code`.
 *
 * @param {Object} options
 * @param {string} options.code the extension source
 * @param {string} options.method one of CALLABLE_METHODS
 * @param {Array}  [options.args] JSON-serialisable arguments
 * @param {Object} [options.source] the source's index.json entry, given to
 *   the extension as `this.source`
 * @param {Object} [options.preferences] the user's settings for this source
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{result:*, logs:Array, requests:Array, durationMs:number}>}
 */
async function runExtension(options = {}) {
  const code = String(options.code ?? '');
  const method = String(options.method ?? '');
  const args = Array.isArray(options.args) ? options.args : [];
  const timeoutMs = Math.min(Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

  if (code.length > MAX_SOURCE_BYTES) {
    throw new ExtensionError(`Extension source exceeds ${MAX_SOURCE_BYTES} bytes`);
  }
  if (!CALLABLE_METHODS.has(method)) {
    throw new ExtensionError(`Method not callable: ${method || '(none)'}`);
  }

  const ops = createOps({ preferences: options.preferences, timeoutMs });
  const started = Date.now();
  let timer = null;

  try {
    const context = createSandbox(ops);

    try {
      vm.runInContext(code, context, {
        filename: 'animiru:extension',
        timeout: SYNC_SLICE_MS
      });
    } catch (err) {
      throw new ExtensionError(`Extension failed to load: ${err.message}`, ops);
    }

    // The invocation is handed over as JSON text and re-parsed inside the
    // realm, so the extension receives its own objects rather than ours.
    const invocationJson = JSON.stringify({
      method,
      args,
      source: options.source || {}
    });
    vm.runInContext(
      `globalThis.__invocation = JSON.parse(${JSON.stringify(invocationJson)});`,
      context,
      { filename: 'animiru:invocation', timeout: SYNC_SLICE_MS }
    );

    const driver = `
      (function () {
        var Ctor = typeof DefaultExtension !== 'undefined' ? DefaultExtension : null;
        if (typeof Ctor !== 'function') {
          throw new Error('Extension does not define a DefaultExtension class');
        }
        var instance = new Ctor(__invocation.source);
        var fn = instance[__invocation.method];
        if (typeof fn !== 'function') {
          throw new Error('Extension does not implement ' + __invocation.method + '()');
        }
        return Promise.resolve(fn.apply(instance, __invocation.args)).then(function (value) {
          return JSON.stringify(value === undefined ? null : value);
        });
      })()
    `;

    let pending;
    try {
      pending = vm.runInContext(driver, context, {
        filename: 'animiru:driver',
        timeout: SYNC_SLICE_MS
      });
    } catch (err) {
      throw new ExtensionError(err.message, ops);
    }

    // Guards the asynchronous tail. It cannot interrupt a spinning
    // extension - see the note at the top - but it does stop a source that
    // is merely waiting forever on a dead host from hanging the request.
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new ExtensionError(`Extension timed out after ${timeoutMs}ms`, ops)),
        timeoutMs
      );
    });

    let resultJson;
    try {
      resultJson = await Promise.race([Promise.resolve(pending), deadline]);
    } catch (err) {
      if (err instanceof ExtensionError) throw err;
      throw new ExtensionError(err && err.message ? String(err.message) : String(err), ops);
    }

    const text = String(resultJson ?? 'null');
    if (text.length > MAX_RESULT_BYTES) {
      throw new ExtensionError(`Extension returned more than ${MAX_RESULT_BYTES} bytes`, ops);
    }

    return {
      result: JSON.parse(text),
      logs: ops.logs,
      requests: ops.requests,
      durationMs: Date.now() - started
    };
  } finally {
    if (timer) clearTimeout(timer);
    ops.dispose();
  }
}

module.exports = {
  runExtension,
  extractMetadata,
  ExtensionError,
  CALLABLE_METHODS,
  DEFAULT_TIMEOUT_MS,
  MAX_SOURCE_BYTES
};
