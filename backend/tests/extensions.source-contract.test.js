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
 *
 * This is a scanner rather than a sequence of regex replacements, because
 * the regex version was wrong in a way that hid it: AniLight has a line
 * comment mentioning the path "/user/*", and the block-comment pattern
 * matched that "/*" against a "*\/" 297 lines later, deleting half the file
 * before the search ever ran. A check searching a file with its middle
 * removed reports no findings and reads exactly like a check that passed.
 *
 * States are tracked in one pass, so a "/*" inside a line comment is a line
 * comment, a quote inside a comment is a comment, and a "//" inside a string
 * is a string. Regex literals are recognised well enough not to be mistaken
 * for division and have their contents swallowed as a string.
 */
function scan(code) {
  const source = String(code);
  /** Every regex literal met on the way, in source order. */
  const regexes = [];
  let out = '';
  let i = 0;
  /** The last significant character emitted, for the regex-or-divide call. */
  let previous = '';

  const keep = (character) => {
    out += character;
    if (!/\s/.test(character)) previous = character;
  };

  while (i < source.length) {
    const two = source.slice(i, i + 2);

    if (two === '//') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }

    if (two === '/*') {
      const close = source.indexOf('*/', i + 2);
      i = close === -1 ? source.length : close + 2;
      out += ' ';
      continue;
    }

    const character = source[i];

    if (character === '"' || character === "'" || character === '`') {
      i += 1;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === character) { i += 1; break; }
        i += 1;
      }
      out += '""';
      previous = '"';
      continue;
    }

    // A slash here is either division or the start of a regex literal. After
    // a value it divides; after an operator or an opening bracket it cannot.
    if (character === '/' && /^$|[([{,;:=!&|?+\-*%~^<>]/.test(previous)) {
      const from = i + 1;
      i += 1;
      let inClass = false;
      while (i < source.length && source[i] !== '\n') {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === '[') inClass = true;
        else if (source[i] === ']') inClass = false;
        else if (source[i] === '/' && !inClass) { break; }
        i += 1;
      }
      // The pattern itself, kept for checks that ask what it matches. The
      // stripped text still loses it, so a search for code cannot trip over
      // a pattern's contents.
      regexes.push(source.slice(from, i));
      i += 1;
      out += '""';
      previous = '"';
      continue;
    }

    keep(character);
    i += 1;
  }

  return { code: out, regexes: regexes };
}

/** The source with comments, strings and regex literals removed. */
function executable(code) {
  return scan(code).code;
}

/** Every regex literal the source contains, as its pattern text. */
function regexLiterals(code) {
  return scan(code).regexes;
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

/**
 * Every use of `name` as a global, ignoring the ways it can appear while
 * meaning something else: `this.fetch()` and `obj.fetch()` are a source's
 * own method, and `fetch(url) {` is where it defines one.
 */
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

/**
 * Every source reaches the network through the one op that can be fixed.
 *
 * This is what makes a fix in the shared transport reach all of them at
 * once: browser identity, the retry, the device handoff for a 403 and the
 * device handoff for a connection that was dropped instead. A source that
 * fetched its own way would get none of it, and would keep failing after
 * every one of those fixes had shipped.
 *
 * The forbidden-globals check above is the other half - it stops a source
 * reaching for fetch or XMLHttpRequest. This half says the door it must use
 * is actually the one it uses.
 */
describe('the one door out', () => {
  /*
   * Playback Diagnostic makes no requests at all: it returns fixed public
   * test-video URLs so playback can be checked without a scraper in the
   * way. Exempt because it has nothing to route, not because it routes
   * around anything.
   */
  const NO_NETWORK = ['playbackdiag.js'];

  it.each(sources.map((s) => [s.file]))('%s fetches through Client, or not at all', (file) => {
    const { code } = sources.find((s) => s.file === file);
    const body = executable(code);

    if (NO_NETWORK.includes(file)) {
      expect(body).not.toMatch(/new\s+Client\s*\(/);
      return;
    }

    expect(body).toMatch(/new\s+Client\s*\(/);
  });

  // A census, so a source added without network access has to be declared
  // rather than quietly widening the exemption.
  it('has exactly one source that makes no requests', () => {
    const silent = sources.filter(({ code }) => !/new\s+Client\s*\(/.test(executable(code)));
    expect(silent.map((s) => s.file)).toEqual(NO_NETWORK);
  });
});

/**
 * The stripper has to leave the code behind.
 *
 * These exist because of a real failure in this file: the first version
 * stripped block comments with a regex, before line comments. AniLight has
 * a line comment mentioning the path "/user/*", and that "/*" matched a
 * "*\/" 297 lines later - so half the file was deleted before any search
 * ran. Every check built on it reported nothing and looked exactly like a
 * check that passed.
 *
 * A stripper that eats code cannot be noticed by the checks that use it.
 * It has to be tested directly.
 */
describe('removing comments and strings without removing code', () => {
  it('does not treat a path inside a line comment as a block comment', () => {
    const code = [
      '// the site gates /user/* behind a login',
      'const client = new Client();',
      'const r = await fetch(u);'
    ].join('\n');

    // The line below the comment must survive, or nothing can be found in it.
    expect(executable(code)).toMatch(/new\s+Client\s*\(/);
    expect(usesGlobal(code, 'fetch')).toBe(true);
  });

  it('keeps the code that follows a real block comment', () => {
    expect(executable('/* gone */ const client = new Client();'))
      .toMatch(/new\s+Client\s*\(/);
  });

  it('does not let a quote inside a comment open a string', () => {
    const code = "// the site's own login\nconst client = new Client();";
    expect(executable(code)).toMatch(/new\s+Client\s*\(/);
  });

  it('does not let a slash inside a string start a comment', () => {
    expect(executable('const u = "https://x.test/a"; const c = new Client();'))
      .toMatch(/new\s+Client\s*\(/);
  });

  it('does not let a quote inside a regex literal open a string', () => {
    expect(executable("const q = /[\"']/g; const c = new Client();"))
      .toMatch(/new\s+Client\s*\(/);
  });

  // The real files are the case that matters: every bundled source has to
  // come through with its code intact, or every check above is blind.
  it.each(sources.map((s) => [s.file]))('%s keeps its executable code', (file) => {
    const { code } = sources.find((s) => s.file === file);
    const stripped = executable(code);

    // Balanced braces are a cheap proof that no block was swallowed whole.
    const opens = (stripped.match(/\{/g) || []).length;
    const closes = (stripped.match(/\}/g) || []).length;
    expect(opens).toBe(closes);
    expect(stripped).toMatch(/class\s+DefaultExtension/);
  });
});

/**
 * No source reads page structure with a regex.
 *
 * Two of the sixteen did: AniNeko with nine, AnimeHeaven with six. Both
 * broke on the markup they were written against, both carried their own
 * hand-written entity decoding, and both are selector-based now like the
 * rest. This is what stops the next one arriving the same way - and the
 * next one is the likeliest to, because its author is newest to the
 * conventions here.
 *
 * The fault is matching the elements a page is BUILT from - its divs,
 * anchors, images, headings, list items, meta tags - to pull content out of
 * them. That is what a parser is for.
 *
 * Three things that look similar are deliberately allowed, because each is
 * reading a value out of text rather than structure out of a page:
 *
 *   - a tag stripper, /<[^>]*>/ with nothing captured, cleaning HTML out of
 *     a description a JSON API returned
 *   - a script or style blob, where the content is JSON or JavaScript and
 *     the tag is only its wrapper (HiAnime reads ld+json this way)
 *   - a <title> probe, used to recognise a video host's error page
 *     (AniKoto and AniLight both do)
 *
 * A pattern is reading structure when it names a content element AND
 * captures something out of it.
 */
describe('reading HTML', () => {
  /** The elements a page's cards and panels are built from. */
  const CONTENT_TAGS = [
    'a', 'div', 'span', 'img', 'p', 'li', 'ul', 'ol', 'tr', 'td', 'th',
    'table', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'article', 'section',
    'meta', 'button', 'iframe', 'figure', 'strong', 'em', 'label', 'option'
  ];
  const NAMES_A_CONTENT_TAG = new RegExp(`<\\/?(?:${CONTENT_TAGS.join('|')})\\b`, 'i');
  /** A capture group, ignoring the non-capturing and assertion forms. */
  const CAPTURES = /\((?!\?[:=!<])/;

  const structureIn = (code) => regexLiterals(code)
    .filter((pattern) => NAMES_A_CONTENT_TAG.test(pattern) && CAPTURES.test(pattern));

  it.each(sources.map((s) => [s.file]))('%s does not match page structure', (file) => {
    const { code } = sources.find((s) => s.file === file);
    expect(structureIn(code)).toEqual([]);
  });

  /*
   * The check is only worth having if it can fail. These plant the shapes
   * AniNeko and AnimeHeaven actually carried, and the shapes that must not
   * be mistaken for them.
   */
  it.each([
    ['a div matcher', "var rx = /<div class='infotitle'>([^<]+)<\\/div>/;"],
    ['an anchor matcher', 'var rx = /<a[^>]+href="([^"]+)"/g;'],
    ['an image matcher', 'var rx = /<img[^>]+src="([^"]+)"[^>]+alt="([^"]*)"/g;'],
    ['a heading matcher', 'var m = html.match(/<h1[^>]*>([\\s\\S]*?)<\\/h1>/);'],
    ['a meta matcher', "var m = html.match(/<meta property='og:image' content='([^']+)'/);"],
    ['a list-item matcher', 'var rx = /<li[^>]*>([^<]+)<\\/li>/g;']
  ])('catches %s', (_, code) => {
    expect(structureIn(code).length).toBe(1);
  });

  it.each([
    ['a tag stripper', 'var t = s.replace(/<[^>]*>/g, " ");'],
    ['a script blob', 'var re = /<script[^>]+ld\\+json[^>]*>([\\s\\S]*?)<\\/script>/gi;'],
    ['a title probe', 'var m = body.match(/<title>File (\\d+)/i);'],
    ['an episode number', 'var m = /(?:ep(?:isode)?\\.?\\s*)(\\d+)/i.exec(label);'],
    ['a quality label', 'var m = /(\\d{3,4})p/.exec(label);'],
    ['a hostname', 'var m = /^(?:https?:)?\\/\\/([^/]+)/i.exec(value);'],
    ['a query parameter', 'var m = embed.match(/[?&](?:sub|caption_1)=([^&]+)/);'],
    ['a comparison against text', 'var ae = /eng/i.test(a.label) ? 0 : 1;']
  ])('does not flag %s', (_, code) => {
    expect(structureIn(code)).toEqual([]);
  });
});
