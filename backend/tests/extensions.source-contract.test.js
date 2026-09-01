/**
 * Static checks over every bundled source.
 *
 * These exist because of failures that reached a device. A source can be
 * syntactically perfect, load cleanly, and still be missing something the
 * app needs - and the app has no way to tell until someone opens a title
 * and finds it called "Untitled".
 *
 * Nothing here runs a source or touches the network. It reads the files, so
 * it is cheap enough to run on every push and catches a whole class of
 * mistake at the moment a source is added rather than on a phone weeks
 * later.
 */

const fs = require('fs');
const path = require('path');
const { extractMetadata } = require('../extensions');

const SOURCES_DIR = path.join(__dirname, '..', '..', 'extensions', 'sources');

const sources = fs.readdirSync(SOURCES_DIR)
  .filter((file) => file.endsWith('.js'))
  .map((file) => ({ file, code: fs.readFileSync(path.join(SOURCES_DIR, file), 'utf8') }));

/**
 * The source with its comments and string literals removed.
 *
 * Both are full of words that look like code: every source sends an
 * "X-Requested-With: XMLHttpRequest" header, and one carries a comment
 * saying atob() is unavailable. Searching the raw text finds the mention
 * rather than the use, so the search happens on what actually executes.
 */
function executable(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:\\.|[^`\\])*`/g, '""')
    .replace(/'(?:\\.|[^'\\\n])*'/g, '""')
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

/** The index just past the argument list that starts at `open`. */
function afterArguments(body, open) {
  let depth = 0;
  for (let i = open; i < body.length; i += 1) {
    if (body[i] === '(') depth += 1;
    else if (body[i] === ')') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function usesGlobal(code, name) {
  const body = executable(code);
  const calls = new RegExp(`(^|[^.\\w$])(new\\s+)?${name}\\s*\\(`, 'gm');

  for (const match of body.matchAll(calls)) {
    const open = match.index + match[0].length - 1;
    const close = afterArguments(body, open);
    // `fetch(url) {` declares a method; `fetch(url);` calls one. What
    // follows the argument list is what tells them apart, wherever the
    // line breaks happen to fall.
    if (close !== -1 && /^\s*\{/.test(body.slice(close, close + 3))) continue;
    return true;
  }

  const members = new RegExp(`(^|[^.\\w$])${name}\\s*[.[]`, 'm');
  return members.test(body);
}

/**
 * Globals a browser or Node has and this sandbox does not.
 *
 * Sources run in a bare realm: the runtime seeds Client, Document,
 * SharedPreferences, MProvider, the crypto helpers and console, and nothing
 * else. A source calling anything on this list throws "X is not defined" on
 * its first run - on a device, for a user, with no sign of it beforehand.
 *
 * None of the bundled sources does. The point of the list is the next one:
 * the shapes below are exactly what an author reaches for out of habit when
 * porting a scraper from a browser.
 */
const ABSENT_GLOBALS = [
  'fetch', 'XMLHttpRequest', 'URLSearchParams', 'atob', 'btoa',
  'localStorage', 'sessionStorage', 'require', 'Buffer', 'process',
  'window', 'setTimeout', 'setInterval', 'TextEncoder', 'TextDecoder',
  'FormData', 'AbortController', 'structuredClone', 'queueMicrotask'
];

describe('every bundled source', () => {
  it('there is at least one to check', () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it.each(sources.map((s) => [s.file]))('%s parses as JavaScript', (file) => {
    const { code } = sources.find((s) => s.file === file);
    expect(() => new (require('vm').Script)(code)).not.toThrow();
  });

  it.each(sources.map((s) => [s.file]))('%s declares what the index needs', (file) => {
    const { code } = sources.find((s) => s.file === file);
    const [declared] = extractMetadata(code);

    expect(declared).toBeTruthy();
    expect(typeof declared.name).toBe('string');
    expect(Number.isInteger(declared.id)).toBe(true);
    expect(typeof declared.baseUrl).toBe('string');
    expect(typeof declared.version).toBe('string');
  });

  /*
   * There is deliberately no static check that getDetail names its title.
   *
   * One was written for exactly the AnimeParadise bug and did not catch it:
   * that method pushes chapters as { name: epName, ... }, so an episode's
   * name satisfied any pattern looking for a name inside the method. The
   * check passed on the bug it existed for, which is worse than no check -
   * it would have waved the next one through too.
   *
   * Telling a title's name from an episode's needs to know which object is
   * returned, and these are fifteen hand-written scrapers with no shared
   * shape. So the protection is in the app instead, where it can be tested
   * properly: the card carries the title it already knows into the detail
   * link, and it is used whenever getDetail returns none. See "a source
   * that returns no title" in frontend Details tests.
   */

  /**
   * The second argument to Client.get and Client.head IS the headers.
   * Passing { headers: {...} } sends one header literally called "headers"
   * and none of the ones intended - which is how Re:ANIME shipped, and the
   * kind of mistake that produces a site refusing a request for no visible
   * reason.
   */
  it.each(sources.map((s) => [s.file]))('%s passes headers as headers', (file) => {
    const { code } = sources.find((s) => s.file === file);

    expect(code).not.toMatch(/\.(get|head)\s*\([^,)]+,\s*\{\s*headers\s*:/);
  });

  /**
   * Reaching for something the sandbox does not have.
   *
   * This is the one class of mistake that is invisible until a user opens
   * the source: the file parses, loads, declares itself correctly, and
   * throws on the first line that runs.
   */
  it.each(sources.map((s) => [s.file]))('%s uses only what the sandbox has', (file) => {
    const { code } = sources.find((s) => s.file === file);
    const reached = ABSENT_GLOBALS.filter((name) => usesGlobal(code, name));

    expect(reached).toEqual([]);
  });
});

/**
 * Ids identify an installed source. Two sources sharing one overwrite each
 * other, and the folder shows one where it holds two - which is how
 * Re:ANIME arrived, carrying AnimePahe's id.
 */
describe('the folder as a whole', () => {
  it('gives every source a different id', () => {
    const byId = new Map();

    for (const { file, code } of sources) {
      const [declared] = extractMetadata(code) || [];
      if (!declared) continue;

      const seen = byId.get(declared.id);
      expect(seen === undefined || seen === file)
        .toBe(true, `id ${declared.id} is used by both ${seen} and ${file}`);
      byId.set(declared.id, file);
    }

    expect(byId.size).toBe(sources.length);
  });
});

/**
 * The check above is only worth having if it can fail.
 *
 * A pattern that matches nothing passes every source for ever and reads
 * exactly like a check that is working, so these plant the mistakes it
 * exists to catch, and the shapes it must not mistake for them.
 */
describe('finding a global the sandbox does not have', () => {
  it.each([
    ['await fetch(u)', 'const r = await fetch(u);', 'fetch'],
    ['new URLSearchParams', 'const p = new URLSearchParams(x);', 'URLSearchParams'],
    ['atob', 'var d = atob(s);', 'atob'],
    ['a bare statement call', 'setTimeout(f, 10);', 'setTimeout'],
    ['a property read', 'var x = window.location;', 'window'],
    ['a static method', 'var b = Buffer.from(s);', 'Buffer'],
    ['new XMLHttpRequest', 'var xhr = new XMLHttpRequest();', 'XMLHttpRequest']
  ])('catches %s', (_, code, name) => {
    expect(usesGlobal(code, name)).toBe(true);
  });

  it.each([
    // AnimePahe defines its own fetch() and calls it through this.
    ['a method the source defined itself',
      'class A { async fetch(url, referer) { return 1; } go() { return this.fetch(1); } }',
      'fetch'],
    // Every source sends this header.
    ['the name inside a header value', 'h = { "X-Requested-With": "XMLHttpRequest" };',
      'XMLHttpRequest'],
    ['a comment saying it is unavailable', '// atob() is not available here', 'atob'],
    ['a method on something else', 'var s = this.process(x);', 'process'],
    ['a property on something else', 'var o = obj.window;', 'window']
  ])('does not mistake %s for one', (_, code, name) => {
    expect(usesGlobal(code, name)).toBe(false);
  });

  it('reads through a definition split across lines', () => {
    expect(usesGlobal('async fetch(\n  url,\n  referer\n) {\n  return 1;\n}', 'fetch'))
      .toBe(false);
  });
});
