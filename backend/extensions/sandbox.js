/**
 * Runs one extension method and returns its result.
 *
 * ## What this is, and what it is not
 *
 * This is an isolation layer, not a security boundary. `node:vm` gives an
 * extension a fresh realm - no require, no process, no Buffer, nothing from
 * this module's scope - and the runtime bootstrap makes sure no host object,
 * promise or error ever reaches extension code.
 *
 * It is not enough to contain a determined attacker. The vm shares this
 * process's heap, and `timeout` only interrupts synchronous execution.
 */

const vm = require('vm');
const { createOps } = require('./ops');
const { RUNTIME_SOURCE } = require('./runtime');
const { buildDiagnostics } = require('./diagnostics');

/**
 * How long a whole run may take.
 *
 * This is a budget for the run, not for one request, and the two were close
 * enough to be the same number: one request may take 15 seconds, so at 20
 * the second slow request in a run had nothing left, and a source that
 * fetched a list and then a page could not finish on a slow site. Now a
 * handful of them fit.
 *
 * The ceiling is the caller's own deadline - the app gives up on a run at
 * 45 seconds - because a timeout reported by the app carries none of the
 * diagnostics that make a failure readable. Staying inside it means the run
 * is always the one that gives up, and always with a trace.
 */
const DEFAULT_TIMEOUT_MS = 40000;
const MAX_TIMEOUT_MS = 60000;
const MAX_SOURCE_BYTES = 512 * 1024;
const MAX_RESULT_BYTES = 4 * 1024 * 1024;
const SYNC_SLICE_MS = 5000;

/** Methods an extension is allowed to expose. */
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
  constructor(message, { logs = [], requests = [] } = {}, diagnostics = null) {
    super(message);
    this.name = 'ExtensionError';
    this.logs = logs;
    this.requests = requests;
    this.diagnostics = diagnostics;
  }
}

/**
 * Creates an isolated extension realm.
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
 * Reads the mangayomiSources declaration from an extension.
 */
function extractMetadata(code, { timeoutMs } = {}) {
  const ops = createOps({});

  try {
    const context = createSandbox(ops);

    vm.runInContext(String(code), context, {
      filename: 'animiru:extension',
      timeout: Math.min(
        Number(timeoutMs) || SYNC_SLICE_MS,
        MAX_TIMEOUT_MS
      )
    });

    const json = vm.runInContext(
      'typeof mangayomiSources !== "undefined" ? JSON.stringify(mangayomiSources) : "null"',
      context,
      {
        filename: 'animiru:metadata',
        timeout: SYNC_SLICE_MS
      }
    );

    const parsed = JSON.parse(String(json));

    if (parsed === null) return [];

    return Array.isArray(parsed) ? parsed : [parsed];
  } finally {
    ops.dispose();
  }
}

/**
 * Creates diagnostics for an empty result without treating it as an
 * extension crash.
 *
 * This deliberately does not inspect or modify the result structure.
 * Different extension methods return different contracts, so structural
 * validation belongs at the source-contract layer rather than the sandbox.
 */
function buildEmptyResultDiagnostics({
  code,
  method,
  source,
  result,
  requests,
  logs
}) {
  const isEmptyArray = Array.isArray(result) && result.length === 0;

  const isNullResult =
    result === null ||
    result === undefined;

  if (!isEmptyArray && !isNullResult) {
    return null;
  }

  return buildDiagnostics({
    message: `Extension returned an empty result for ${method}()`,
    code,
    requests,
    logs,
    source,
    method,
    result: {
      type: isEmptyArray ? 'empty-array' : 'null',
      count: 0
    }
  });
}

/**
 * Runs one extension method.
 *
 * @param {Object} options
 * @param {string} options.code
 * @param {string} options.method
 * @param {Array} [options.args]
 * @param {Object} [options.source]
 * @param {Object} [options.preferences]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<Object>}
 */
async function runExtension(options = {}) {
  const code = String(options.code ?? '');
  const method = String(options.method ?? '');
  const args = Array.isArray(options.args)
    ? options.args
    : [];

  const timeoutMs = Math.min(
    Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS,
    MAX_TIMEOUT_MS
  );

  if (code.length > MAX_SOURCE_BYTES) {
    throw new ExtensionError(
      `Extension source exceeds ${MAX_SOURCE_BYTES} bytes`
    );
  }

  if (!CALLABLE_METHODS.has(method)) {
    throw new ExtensionError(
      `Method not callable: ${method || '(none)'}`
    );
  }

  const ops = createOps({
    preferences: options.preferences,
    timeoutMs,
    fetched: options.fetched,
    allowHandoff: Boolean(options.allowHandoff)
  });

  const started = Date.now();
  let timer = null;

  try {
    const context = createSandbox(ops);

    /*
     * Load extension source.
     */
    try {
      vm.runInContext(code, context, {
        filename: 'animiru:extension',
        timeout: SYNC_SLICE_MS
      });
    } catch (err) {
      const message = `Extension failed to load: ${err.message}`;

      throw new ExtensionError(
        message,
        ops,
        buildDiagnostics({
          message,
          stack: err.stack,
          code,
          requests: ops.requests,
          logs: ops.logs,
          source: options.source,
          method
        })
      );
    }

    /*
     * Pass invocation data into the isolated realm as JSON.
     */
    const invocationJson = JSON.stringify({
      method,
      args,
      source: options.source || {}
    });

    vm.runInContext(
      `globalThis.__invocation = JSON.parse(${JSON.stringify(invocationJson)});`,
      context,
      {
        filename: 'animiru:invocation',
        timeout: SYNC_SLICE_MS
      }
    );

    /*
     * Build the extension driver.
     */
    const driver = `
      (function () {
        var Ctor =
          typeof DefaultExtension !== 'undefined'
            ? DefaultExtension
            : null;

        if (typeof Ctor !== 'function') {
          throw new Error(
            'Extension does not define a DefaultExtension class'
          );
        }

        var instance = new Ctor(__invocation.source);

        /*
         * Mangayomi sources commonly call super() without passing the source.
         * Therefore attach the invocation source after construction.
         */
        var declared = instance.source;
        var merged = {};

        for (var k in __invocation.source) {
          if (
            Object.prototype.hasOwnProperty.call(
              __invocation.source,
              k
            )
          ) {
            merged[k] = __invocation.source[k];
          }
        }

        if (declared && typeof declared === 'object') {
          for (var j in declared) {
            if (
              Object.prototype.hasOwnProperty.call(
                declared,
                j
              ) &&
              declared[j] !== undefined &&
              declared[j] !== null &&
              declared[j] !== ''
            ) {
              merged[j] = declared[j];
            }
          }
        }

        instance.source = merged;

        /*
         * Apply declared source preference defaults.
         */
        try {
          if (
            typeof instance.getSourcePreferences ===
            'function'
          ) {
            __declarePreferenceDefaults(
              instance.getSourcePreferences()
            );
          }
        } catch (e) {
          /*
           * A source without usable preferences is allowed.
           */
        }

        var fn = instance[__invocation.method];

        if (typeof fn !== 'function') {
          throw new Error(
            'Extension does not implement ' +
            __invocation.method +
            '()'
          );
        }

        return Promise.resolve(
          fn.apply(instance, __invocation.args)
        ).then(function (value) {
          return JSON.stringify(
            value === undefined
              ? null
              : value
          );
        });
      })()
    `;

    let pending;

    try {
      pending = vm.runInContext(
        driver,
        context,
        {
          filename: 'animiru:driver',
          timeout: SYNC_SLICE_MS
        }
      );
    } catch (err) {
      throw new ExtensionError(
        err.message,
        ops,
        buildDiagnostics({
          message: err.message,
          stack: err.stack,
          code,
          requests: ops.requests,
          logs: ops.logs,
          source: options.source,
          method
        })
      );
    }

    /*
     * Protect against asynchronous requests that never finish.
     */
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const message =
          `Extension timed out after ${timeoutMs}ms`;

        reject(
          new ExtensionError(
            message,
            ops,
            buildDiagnostics({
              message,
              code,
              requests: ops.requests,
              logs: ops.logs,
              source: options.source,
              method
            })
          )
        );
      }, timeoutMs);
    });

    let resultJson;

    try {
      resultJson = await Promise.race([
        Promise.resolve(pending),
        deadline
      ]);
    } catch (err) {
      if (ops.pendingHandoff) {
        throw ops.pendingHandoff;
      }

      if (err instanceof ExtensionError) {
        throw err;
      }

      const message =
        err && err.message
          ? String(err.message)
          : String(err);

      throw new ExtensionError(
        message,
        ops,
        buildDiagnostics({
          message,
          stack: err && err.stack,
          code,
          requests: ops.requests,
          logs: ops.logs,
          source: options.source,
          method
        })
      );
    }

    /*
     * A refused request must take precedence over a partial result.
     */
    if (ops.pendingHandoff) {
      throw ops.pendingHandoff;
    }

    /*
     * Serialize and size-check the result.
     */
    const text = String(
      resultJson ?? 'null'
    );

    if (text.length > MAX_RESULT_BYTES) {
      const message =
        `Extension returned more than ${MAX_RESULT_BYTES} bytes`;

      throw new ExtensionError(
        message,
        ops,
        buildDiagnostics({
          message,
          code,
          requests: ops.requests,
          logs: ops.logs,
          source: options.source,
          method
        })
      );
    }

    /*
     * Parse the result exactly once.
     */
    let result;

    try {
      result = JSON.parse(text);
    } catch (err) {
      const message =
        `Extension returned invalid JSON: ${err.message}`;

      throw new ExtensionError(
        message,
        ops,
        buildDiagnostics({
          message,
          stack: err.stack,
          code,
          requests: ops.requests,
          logs: ops.logs,
          source: options.source,
          method
        })
      );
    }

    /*
     * Empty-result diagnostics.
     *
     * IMPORTANT:
     * This does NOT fail the extension.
     *
     * It simply records useful diagnostic information so that a source
     * returning zero results can be investigated without pretending the
     * extension crashed.
     */
    const emptyDiagnostics =
      buildEmptyResultDiagnostics({
        code,
        method,
        source: options.source,
        result,
        requests: ops.requests,
        logs: ops.logs
      });

    return {
      result,
      logs: ops.logs,
      requests: ops.requests,
      durationMs: Date.now() - started,
      ...(emptyDiagnostics
        ? { diagnostics: emptyDiagnostics }
        : {})
    };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }

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
