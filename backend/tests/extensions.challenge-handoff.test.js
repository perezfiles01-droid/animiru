/**
 * A bot-protection challenge served as a successful response.
 *
 * Handing a refused request to the device already works when the site says
 * so with a status code: 403, 429, 503. But the common shape of a Cloudflare
 * interstitial is HTTP 200 carrying a challenge page - the site answers
 * cheerfully and the body is a browser check rather than the page asked for.
 *
 * That is the same refusal, aimed at the same thing: the datacenter address
 * the request came from, not the URL. Before this, it was not read as one.
 * Two of sixteen sources noticed it themselves and threw an error saying the
 * check was aimed at the server rather than the device - correctly - and
 * then never asked the device. The other fourteen handed the challenge HTML
 * to their parser, which found no anime in it.
 *
 * Since a home is accepted on what it parses, that empty parse reads as a
 * dead home, so the rotation moves on and spends its whole budget being
 * challenged once per mirror. The user waits for the full budget and is
 * shown an empty list, when the phone in their hand could have loaded the
 * page on the first try.
 */

const fs = require('fs');
const path = require('path');

const { runExtension } = require('../extensions');
const { DeviceFetchRequired } = require('../extensions/handoff');
const http = require('../extensions/http');

const SOURCES_DIR = path.join(__dirname, '..', '..', 'extensions', 'sources');

const CODE = `
  const mangayomiSources = [{ name: 'Challenged', id: 1, version: '1.0.0', baseUrl: 'https://site.test' }];
  class DefaultExtension extends MProvider {
    async getPopular(page) {
      const res = await new Client().get('https://site.test/home');
      const names = [...res.body.matchAll(/<a class="anime">([^<]+)<\\/a>/g)].map((m) => m[1]);
      return { list: names.map((name) => ({ name, link: name })), hasNextPage: false };
    }
    getSourcePreferences() { return []; }
  }
`;

/** A source that catches its own failure and answers with less. */
const SWALLOWING_CODE = `
  const mangayomiSources = [{ name: 'Quiet', id: 2, version: '1.0.0', baseUrl: 'https://site.test' }];
  class DefaultExtension extends MProvider {
    async getPopular(page) {
      try {
        await new Client().get('https://site.test/home');
      } catch (err) {
        return { list: [], hasNextPage: false };
      }
      return { list: [{ name: 'never', link: 'never' }], hasNextPage: false };
    }
    getSourcePreferences() { return []; }
  }
`;

/**
 * What Cloudflare actually sends: 200, text/html, and the challenge script
 * it has to load for the check to run.
 */
const CLOUDFLARE_INTERSTITIAL = `<!DOCTYPE html><html><head>
  <title>Just a moment...</title>
</head><body>
  <div id="cf-wrapper"><div class="cf-browser-verification"></div></div>
  <script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1?ray=8f2"></script>
  <script>window._cf_chl_opt={cvId:'3',cType:'managed'};</script>
</body></html>`;

const DDOS_GUARD_INTERSTITIAL = `<!DOCTYPE html><html><head>
  <title>DDoS-Guard</title>
</head><body>
  <script src="/.well-known/ddos-guard/check"></script>
</body></html>`;

/**
 * The shape that must NOT be read as a challenge.
 *
 * A real page is allowed to say "just a moment" - it is ordinary English and
 * a plausible episode title. Detection that keys on the phrase hands real
 * pages to the device for ever, which is slower and wronger than doing
 * nothing, and gets the check switched off within a week.
 */
const INNOCENT_PAGE = `<!DOCTYPE html><html><head>
  <title>Just a Moment, Please - Episode 4</title>
</head><body>
  <p>Checking your browser history is a theme of this arc.</p>
  <a class="anime">Just a Moment, Please</a>
  <a class="anime">Second Show</a>
</body></html>`;

const answerWith = (statusCode, body, headers = { 'content-type': 'text/html' }) =>
  jest.spyOn(http, 'request').mockResolvedValue({
    statusCode, headers, body, url: 'https://site.test/home'
  });

const run = (options) => runExtension({
  code: CODE, method: 'getPopular', args: [1], allowHandoff: true, ...options
});

afterEach(() => jest.restoreAllMocks());

describe('when the site answers 200 with a browser check', () => {
  it('hands the request to the device instead of parsing the challenge', async () => {
    answerWith(200, CLOUDFLARE_INTERSTITIAL);

    await expect(run()).rejects.toBeInstanceOf(DeviceFetchRequired);
  });

  it('names the exact request the device has to make', async () => {
    answerWith(200, CLOUDFLARE_INTERSTITIAL);

    const err = await run().catch((e) => e);

    expect(err.request.url).toBe('https://site.test/home');
    expect(err.request.method).toBe('GET');
  });

  it('reads a DDoS-Guard check the same way', async () => {
    answerWith(200, DDOS_GUARD_INTERSTITIAL);

    await expect(run()).rejects.toBeInstanceOf(DeviceFetchRequired);
  });

  it('is not swallowed by a source that catches its own failure', async () => {
    answerWith(200, CLOUDFLARE_INTERSTITIAL);

    await expect(run({ code: SWALLOWING_CODE })).rejects.toBeInstanceOf(DeviceFetchRequired);
  });

  it('stays a plain answer when there is no device to ask', async () => {
    answerWith(200, CLOUDFLARE_INTERSTITIAL);

    const outcome = await run({ allowHandoff: false });

    expect(outcome.result.list).toEqual([]);
  });
});

describe('a real page that happens to read like one', () => {
  it('is parsed, not handed to the device', async () => {
    answerWith(200, INNOCENT_PAGE);

    const outcome = await run();

    expect(outcome.result.list.map((item) => item.name)).toEqual([
      'Just a Moment, Please', 'Second Show'
    ]);
  });
});

describe('the sources themselves', () => {
  const sources = fs.readdirSync(SOURCES_DIR).filter((name) => name.endsWith('.js'));

  it('enumerates every source, so one added later is covered too', () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  /**
   * Detecting a challenge is the transport's job now. A source that does it
   * itself throws instead of handing off, which is the failure this change
   * exists to remove - so no source may reintroduce it.
   */
  it.each(sources)('%s does not detect a challenge itself', (name) => {
    const code = fs.readFileSync(path.join(SOURCES_DIR, name), 'utf8');
    const executable = stripCommentsAndStrings(code);

    expect(executable).not.toMatch(/cf-browser-verification|challenge-platform|_cf_chl|ddos-guard/i);
  });
});

/**
 * Comments and string literals mention the very things being searched for -
 * a source explaining why it no longer detects a challenge would fail the
 * check for saying so. Only what executes is searched.
 *
 * This is a single pass with a state, not a chain of replaces. A chain gets
 * this wrong in a way that hides itself: run against the real sources, one
 * removing block comments first matched a `/*` written inside a line comment
 * against a `*\/` far below it and deleted every line in between. Each check
 * built on it then passed, having been handed almost nothing to search.
 *
 * Regex literals are skipped rather than parsed, using the usual heuristic -
 * a `/` starting an expression opens a pattern, a `/` after a value divides.
 * Getting that wrong matters here: a pattern containing a quote would
 * otherwise open a string that never closes and swallow the rest of the file.
 */
function stripCommentsAndStrings(code) {
  const out = [];
  // What a `/` means depends on whether a value just ended. After a name,
  // a number, or a closing bracket it divides; anywhere else it opens a
  // pattern.
  let valueJustEnded = false;
  let i = 0;

  while (i < code.length) {
    const ch = code[i];
    const next = code[i + 1];

    if (ch === '/' && next === '/') {
      while (i < code.length && code[i] !== '\n') i += 1;
      continue;
    }

    if (ch === '/' && next === '*') {
      i += 2;
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i += 1;
      i += 2;
      out.push(' ');
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      i += 1;
      while (i < code.length && code[i] !== ch) {
        i += code[i] === '\\' ? 2 : 1;
      }
      i += 1;
      out.push(ch, ch);
      valueJustEnded = true;
      continue;
    }

    if (ch === '/' && !valueJustEnded) {
      const start = i;
      i += 1;
      let inClass = false;
      while (i < code.length) {
        if (code[i] === '\\') { i += 2; continue; }
        if (code[i] === '[') inClass = true;
        else if (code[i] === ']') inClass = false;
        else if (code[i] === '/' && !inClass) break;
        else if (code[i] === '\n') break;
        i += 1;
      }
      i += 1;
      // The literal is kept, not blanked. A source that detects a challenge
      // writes the markers in a pattern, so blanking patterns would leave
      // the check below searching everything except the one place it lives.
      out.push(code.slice(start, i));
      valueJustEnded = true;
      continue;
    }

    if (!/\s/.test(ch)) valueJustEnded = /[A-Za-z0-9_$)\]]/.test(ch);
    out.push(ch);
    i += 1;
  }

  return out.join('');
}

describe('the stripper the source check leans on', () => {
  const sources = fs.readdirSync(SOURCES_DIR).filter((name) => name.endsWith('.js'));

  /**
   * A stripper that eats code makes every check above pass on nothing, which
   * reads exactly like a clean sweep. So it is asserted against the real
   * files, not a synthetic snippet.
   */
  it.each(sources)('leaves %s\'s class declaration standing', (name) => {
    const code = fs.readFileSync(path.join(SOURCES_DIR, name), 'utf8');

    expect(stripCommentsAndStrings(code)).toMatch(/class\s+DefaultExtension\s+extends\s+MProvider/);
  });

  it('removes a comment but keeps the line of code after it', () => {
    expect(stripCommentsAndStrings('// challenge-platform\nconst x = 1;'))
      .toMatch(/const x = 1;/);
    expect(stripCommentsAndStrings('// challenge-platform\nconst x = 1;'))
      .not.toMatch(/challenge-platform/);
  });

  it('keeps a URL that is written where URLs are actually written', () => {
    expect(stripCommentsAndStrings('const u = "https://site.test/a"; keep();'))
      .toMatch(/keep\(\)/);
  });

  it('keeps a pattern, which is where a source would write its detection', () => {
    expect(stripCommentsAndStrings('if (/challenge-platform/i.test(b)) throw 1;'))
      .toMatch(/challenge-platform/);
  });

  it('does not let a pattern containing a quote swallow the rest of the file', () => {
    expect(stripCommentsAndStrings("const q = /it's/; const kept = 1;"))
      .toMatch(/const kept = 1;/);
  });

  it('does not let a line comment swallow code with a later block close', () => {
    const code = '// note about /* something\nconst kept = 1;\n/* real */\nconst also = 2;';
    const stripped = stripCommentsAndStrings(code);

    expect(stripped).toMatch(/const kept = 1;/);
    expect(stripped).toMatch(/const also = 2;/);
  });
});
