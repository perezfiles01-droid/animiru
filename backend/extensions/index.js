/**
 * The extension runtime.
 *
 * `runExtension` executes one method of one source; `extractMetadata` reads
 * a source's `mangayomiSources` declaration without calling into it. Both
 * run the same sandbox, described in ./sandbox.js.
 */

const { runExtension, extractMetadata, ExtensionError, CALLABLE_METHODS } = require('./sandbox');

module.exports = { runExtension, extractMetadata, ExtensionError, CALLABLE_METHODS };
