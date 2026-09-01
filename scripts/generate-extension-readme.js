#!/usr/bin/env node
/**
 * Writes extensions/README.md from the sources on disk.
 *
 * GitHub renders a folder's README when you open the folder, so this is what
 * the extensions folder shows: the URL to paste, and a table of everything
 * currently in it. Both regenerated, because a hand-written list of sources
 * goes stale the first time one is added and then quietly misleads.
 *
 * Everything above the generated marker is prose and is kept as it is - the
 * install instructions and the guide to adding a source do not change when
 * an extension is added, and rewriting them from a template would mean
 * editing this script to fix a typo.
 *
 * Usage:
 *   node scripts/generate-extension-readme.js          write it
 *   node scripts/generate-extension-readme.js --check  fail if it is stale
 */

const fs = require('fs');
const path = require('path');
const { build } = require('./generate-extension-index');

const README_PATH = path.join(__dirname, '..', 'extensions', 'README.md');

/**
 * Everything after this line is rebuilt; everything before it is left alone.
 * A marker rather than a whole-file template so the prose stays editable by
 * hand without touching this script.
 */
const MARKER = '<!-- generated: the table below is rebuilt on every push -->';

const LANGUAGES = { en: 'English', ja: 'Japanese', es: 'Spanish', fr: 'French', all: 'All' };

function languageOf(code) {
  return LANGUAGES[code] || String(code || '').toUpperCase();
}

/** The site a source scrapes, as a link, without the scheme. */
function siteLink(baseUrl) {
  const text = String(baseUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  return text ? `[${text}](${baseUrl})` : '—';
}

function table(entries) {
  if (!entries.length) {
    return '_No extensions yet. Drop a `.js` file into `sources/` and push._\n';
  }

  // Sorted by name, the same order index.json uses. Listing the two
  // differently makes it look as though they disagree.
  const rows = [...entries]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => `| ${e.name} | ${languageOf(e.lang)} | ${e.version} | ${siteLink(e.baseUrl)} | ${otherHomes(e)} |`)
    .join('\n');

  const count = `${entries.length} extension${entries.length === 1 ? '' : 's'}`;
  return `${count}.\n\n`
    + '| Extension | Language | Version | Site | Other homes |\n'
    + '| --- | --- | --- | --- | --- |\n'
    + `${rows}\n`;
}

/**
 * The other addresses a source says it runs on.
 *
 * Counted rather than listed: some sources name more than a dozen, and a
 * table cell holding all of them would be unreadable. The count is the part
 * worth seeing at a glance - it says whether a source has anywhere to go
 * when its usual home is down.
 */
function otherHomes(entry) {
  const mirrors = Array.isArray(entry.mirrors) ? entry.mirrors : [];
  if (!mirrors.length) return '-';

  return `${mirrors.length}`;
}

function render(existing, entries) {
  const marker = existing.indexOf(MARKER);
  const prose = marker === -1 ? existing.trimEnd() : existing.slice(0, marker).trimEnd();
  return `${prose}\n\n${MARKER}\n\n## Extensions in this folder\n\n${table(entries)}`;
}

function main() {
  const check = process.argv.includes('--check');
  const existing = fs.existsSync(README_PATH) ? fs.readFileSync(README_PATH, 'utf8') : '';

  let text;
  try {
    text = render(existing, build());
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  if (check) {
    if (existing !== text) {
      console.error(
        'extensions/README.md is out of date.\n'
        + 'Run `node scripts/generate-extension-readme.js` and commit the result.'
      );
      process.exit(1);
    }
    console.log('extensions/README.md is up to date.');
    return;
  }

  fs.writeFileSync(README_PATH, text);
  console.log('Wrote extensions/README.md.');
}

if (require.main === module) main();

module.exports = { render, table, siteLink, languageOf, MARKER };
