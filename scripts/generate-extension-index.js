#!/usr/bin/env node
/**
 * Builds extensions/index.json from the source files themselves.
 *
 * The index used to be written by hand, which meant every new source had to
 * be described twice - once in its own `mangayomiSources` header and once in
 * the index - and the two drifted. A source whose version was bumped in one
 * place but not the other would silently keep serving the old code, because
 * the app caches by version.
 *
 * So the header is the only place anything is declared, and the index is
 * derived from it. They cannot disagree any more.
 *
 * The declaration is read with the same extractMetadata() the app uses to run
 * these files - a real evaluation in the sandbox, not a regex - so whatever
 * the generator records here is exactly what the app will see at runtime.
 *
 * Usage:
 *   node scripts/generate-extension-index.js          write the index
 *   node scripts/generate-extension-index.js --check  fail if it is stale
 *
 * --check is what CI runs on a pull request: it rebuilds the index in memory
 * and exits non-zero if the committed file differs, so a hand-edit or a
 * forgotten regeneration is caught at push time rather than showing up as a
 * missing source in the app with nothing to explain it.
 */

const fs = require('fs');
const path = require('path');
const { extractMetadata } = require('../backend/extensions');

const ROOT = path.join(__dirname, '..');
const SOURCES_DIR = path.join(ROOT, 'extensions', 'sources');
const INDEX_PATH = path.join(ROOT, 'extensions', 'index.json');

/**
 * Where a source's code is served from.
 *
 * Absolute, not a path relative to the index. Animiru resolves a relative
 * pkgPath, but Mangayomi does not - so a relative entry makes the same
 * repository work in one app and fail in the other. An absolute URL works
 * in both, which is the whole point of publishing in this format.
 */
const RAW_BASE = process.env.EXTENSION_RAW_BASE
  || 'https://raw.githubusercontent.com/perezfiles01-droid/animiru/main/extensions/sources';

/** Fields carried into the index, with the defaults Mangayomi expects. */
function toEntry(declared, fileName) {
  return {
    name: String(declared.name),
    id: declared.id,
    lang: String(declared.lang || 'en'),
    baseUrl: String(declared.baseUrl || ''),
    apiUrl: String(declared.apiUrl || ''),
    iconUrl: String(declared.iconUrl || ''),
    version: String(declared.version || '0.0.1'),
    // 0 manga, 1 anime, 2 novel. Anime unless the source says otherwise.
    itemType: Number.isInteger(declared.itemType) ? declared.itemType : 1,
    isNsfw: declared.isNsfw === true,
    hasCloudflare: declared.hasCloudflare === true,
    isManga: declared.itemType === 0,
    typeSource: String(declared.typeSource || 'single'),
    sourceCodeUrl: `${RAW_BASE}/${fileName}`,
    // Kept alongside sourceCodeUrl: Animiru accepts either, and an installed
    // source that predates the absolute URL still resolves.
    pkgPath: `sources/${fileName}`
  };
}

/** Everything wrong with one source, so a bad file reports all of it at once. */
function problemsWith(declared, fileName) {
  const problems = [];
  if (!declared || typeof declared !== 'object') {
    return [`${fileName}: mangayomiSources does not declare an object`];
  }
  if (!declared.name) problems.push(`${fileName}: no "name"`);
  if (!Number.isInteger(declared.id)) {
    problems.push(`${fileName}: "id" must be a whole number, got ${JSON.stringify(declared.id)}`);
  }
  if (!declared.baseUrl) problems.push(`${fileName}: no "baseUrl"`);
  if (!declared.version) problems.push(`${fileName}: no "version"`);
  return problems;
}

function build() {
  if (!fs.existsSync(SOURCES_DIR)) {
    throw new Error(`No sources directory at ${SOURCES_DIR}`);
  }

  const files = fs.readdirSync(SOURCES_DIR).filter((f) => f.endsWith('.js')).sort();
  const entries = [];
  const problems = [];
  const seenIds = new Map();

  for (const fileName of files) {
    const code = fs.readFileSync(path.join(SOURCES_DIR, fileName), 'utf8');

    let declarations;
    try {
      declarations = extractMetadata(code);
    } catch (err) {
      problems.push(`${fileName}: could not be read - ${err.message}`);
      continue;
    }

    if (!declarations.length) {
      problems.push(`${fileName}: declares no mangayomiSources`);
      continue;
    }

    // One file may declare several sources - one per language, usually.
    for (const declared of declarations) {
      const found = problemsWith(declared, fileName);
      if (found.length) {
        problems.push(...found);
        continue;
      }

      // Two sources sharing an id would install over each other, and the
      // second would be unreachable with nothing to say why.
      const clash = seenIds.get(declared.id);
      if (clash) {
        problems.push(`${fileName}: id ${declared.id} is already used by ${clash}`);
        continue;
      }
      seenIds.set(declared.id, fileName);

      entries.push(toEntry(declared, fileName));
    }
  }

  if (problems.length) {
    const error = new Error(`Cannot build the index:\n  ${problems.join('\n  ')}`);
    error.problems = problems;
    throw error;
  }

  return entries;
}

/** Sorted by name so the file does not churn when a source is added. */
function serialise(entries) {
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

function main() {
  const check = process.argv.includes('--check');
  let text;

  try {
    text = serialise(build());
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  if (check) {
    const current = fs.existsSync(INDEX_PATH) ? fs.readFileSync(INDEX_PATH, 'utf8') : '';
    if (current !== text) {
      console.error(
        'extensions/index.json is out of date.\n'
        + 'It is generated - run `node scripts/generate-extension-index.js` and commit the result.'
      );
      process.exit(1);
    }
    console.log('extensions/index.json is up to date.');
    return;
  }

  fs.writeFileSync(INDEX_PATH, text);
  const count = JSON.parse(text).length;
  console.log(`Wrote extensions/index.json - ${count} source${count === 1 ? '' : 's'}.`);
}

if (require.main === module) main();

module.exports = { build, serialise, toEntry, problemsWith, RAW_BASE };
