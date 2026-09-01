/**
 * What the app says when a source breaks.
 *
 * A scraper fails constantly and for dull reasons, and the raw message is
 * almost never the useful part - "Cannot read properties of null" does not
 * say which selector stopped matching, or that the site returned a 403 two
 * lines earlier. These tests pin the parts that make a failure actionable:
 * the failing line quoted from the source, a cause in words, a fix, and the
 * request trace.
 */

const { runExtension, ExtensionError } = require('../extensions');
const { explain, locate, excerpt } = require('../extensions/diagnostics');
const http = require('../extensions/http');

/** Runs a source and returns the diagnostics from its failure. */
async function failing(code, { method = 'search', args = ['q', 1], source = {} } = {}) {
  try {
    await runExtension({ code, method, args, source });
  } catch (err) {
    expect(err).toBeInstanceOf(ExtensionError);
    return err.diagnostics;
  }
  throw new Error('Expected the extension to fail');
}

describe('locating the failure', () => {
  it('points at the line in the source, not at the runtime', async () => {
    const code = [
      'class DefaultExtension extends MProvider {',   // 1
      '  async search(query, page) {',                 // 2
      '    const doc = new Document("<p>hi</p>");',    // 3
      '    return doc.selectFirst(".missing").text;',  // 4  <- fails here
      '  }',                                           // 5
      '}'                                              // 6
    ].join('\n');

    const diagnostics = await failing(code);

    expect(diagnostics.location.line).toBe(4);
    expect(diagnostics.location.where).toContain('search');
  });

  it('quotes the failing line with its neighbours, numbered as the file is', async () => {
    const code = [
      'class DefaultExtension extends MProvider {',
      '  async search() {',
      '    const doc = new Document("<p>hi</p>");',
      '    return doc.selectFirst(".missing").text;',
      '  }',
      '}'
    ].join('\n');

    const diagnostics = await failing(code);
    const failingLine = diagnostics.excerpt.find((line) => line.failing);

    expect(failingLine.number).toBe(4);
    expect(failingLine.text).toContain('selectFirst(".missing")');
    // Context either side, so the author can see what the line belongs to.
    expect(diagnostics.excerpt.length).toBeGreaterThan(1);
  });

  it('ignores frames from our own runtime', () => {
    const stack = [
      'TypeError: x',
      '    at Element.selectFirst (animiru:runtime:42:10)',
      '    at DefaultExtension.search (animiru:extension:7:15)',
      '    at animiru:driver:1:1'
    ].join('\n');

    expect(locate(stack)).toMatchObject({ line: 7, column: 15 });
  });

  it('reports no location when the stack has none', () => {
    expect(locate('Error: nothing useful')).toBeNull();
    expect(locate(undefined)).toBeNull();
  });
});

describe('explaining the failure', () => {
  it.each([
    ['Cannot read properties of null (reading \'text\')', /selector matched nothing/i, /selectFirst\(\) returns null/],
    ['doc.text is not a function', /not a function/i, /only select, selectFirst and attr are methods/],
    ['Client is not defined', /does not exist in the sandbox/i, /new Client\(\)/],
    ['Code generation from strings disallowed for this context', /eval\(\) or new Function\(\)/i, /unpackJs/],
    ['Unexpected token \'<\', "<html>" is not valid JSON', /not JSON/i, /error page, a rate limit/],
    ['Extension timed out after 20000ms', /longer than 20000ms/i, /stopped responding/],
    ['Refusing to fetch a private address: 127.0.0.1', /own network/i, /Only public addresses/],
    ['Extension exceeded 60 requests in one call', /more than 60 requests/i, /loop that does not end/],
    // What users were shown as "an error the app does not recognise", with
    // the real cause sitting in the trace right underneath it.
    ['Invalid URL: undefined/ongoing?page=1', /base URL that was not set/i, /this\.source\.baseUrl was undefined/],
    ['Invalid URL: undefined/filter?sort_by=m_view&page=1', /undefined\/filter/, /index\.json entry/],
    ['Invalid URL: null', /base URL that was not set/i, /baseUrl/],
    ['Invalid URL: /watch/one-piece', /"\/watch\/one-piece", which is not a usable URL/, /missing scheme/]
  ])('turns %s into a cause and a fix', (message, causePattern, fixPattern) => {
    const { cause, fix } = explain(message);
    expect(cause).toMatch(causePattern);
    expect(fix).toMatch(fixPattern);
  });

  it('still says something useful for a message it does not recognise', () => {
    const { cause, fix } = explain('something entirely unexpected');
    expect(cause).toBeTruthy();
    expect(fix).toMatch(/request trace/);
  });
});

/**
 * A site that is slow, or that drops the connection, is not a broken source.
 *
 * These arrive from the network layer in wording nothing here chose -
 * axios says "timeout of 14955ms exceeded", Node says "read ECONNRESET" -
 * and every one of them used to fall through to "an error the app does not
 * recognise", which tells a reader nothing about a site that was simply
 * slow. Every source reaches the network the same way, so every source
 * shows the same unhelpful message.
 */
describe('explaining a request that never got an answer', () => {
  const recognised = (message) => expect(explain(message).cause)
    .not.toMatch(/does not recognise/);

  it.each([
    ['timeout of 14955ms exceeded'],
    ['connect ETIMEDOUT 1.2.3.4:443'],
    ['read ECONNRESET'],
    ['socket hang up'],
    ['getaddrinfo ENOTFOUND anineko.test'],
    ['connect ECONNREFUSED 1.2.3.4:443'],
    ['certificate has expired']
  ])('recognises %s', (message) => recognised(message));

  it('names how long the request waited', () => {
    expect(explain('timeout of 14955ms exceeded').cause).toContain('14955ms');
  });

  // The run budget and one request are different failures wanting
  // different advice, and their messages both contain "timed out".
  it('tells a slow request apart from a run that overran', () => {
    expect(explain('timeout of 14955ms exceeded').cause).toMatch(/request/i);
    expect(explain('Extension timed out after 20000ms').cause).toMatch(/ran longer/i);
  });

  it('names the host that did not resolve, without the punctuation', () => {
    expect(explain('Could not resolve anineko.test: getaddrinfo ENOTFOUND').cause)
      .toContain('"anineko.test"');
  });
});

describe('the request trace', () => {
  afterEach(() => jest.restoreAllMocks());

  it('carries every request the source made before it failed', async () => {
    jest.spyOn(http, 'request').mockResolvedValue({
      statusCode: 200, body: '<html>not json</html>', headers: {}, url: 'https://site.test/api'
    });

    const diagnostics = await failing(`
      class DefaultExtension extends MProvider {
        async search() {
          const res = await new Client().get("https://site.test/api");
          return JSON.parse(res.body);
        }
      }
    `);

    expect(diagnostics.requests).toHaveLength(1);
    expect(diagnostics.requests[0]).toMatchObject({ url: 'https://site.test/api', status: 200 });
    expect(diagnostics.cause).toMatch(/not JSON/);
  });

  it('singles out requests that failed, since those are usually the real cause', async () => {
    // A 403 two lines above a null selector is the answer, and easy to miss
    // in a long trace.
    jest.spyOn(http, 'request').mockResolvedValue({
      statusCode: 403, body: 'Forbidden', headers: {}, url: 'https://site.test/blocked'
    });

    const diagnostics = await failing(`
      class DefaultExtension extends MProvider {
        async search() {
          const res = await new Client().get("https://site.test/blocked");
          const doc = new Document(res.body);
          return doc.selectFirst("div.card").text;
        }
      }
    `);

    expect(diagnostics.failedRequests).toHaveLength(1);
    expect(diagnostics.failedRequests[0].status).toBe(403);
  });

  it('keeps the console output the source produced', async () => {
    const diagnostics = await failing(`
      class DefaultExtension extends MProvider {
        async search() {
          console.warn("about to read a missing node");
          return null.length;
        }
      }
    `);

    expect(diagnostics.logs[0]).toMatchObject({
      level: 'warn', message: 'about to read a missing node'
    });
  });
});

describe('naming the source', () => {
  it('records which source and method failed', async () => {
    const diagnostics = await failing('class DefaultExtension extends MProvider { async search() { return null.x; } }', {
      source: { name: 'Example', version: '1.2.0', codeUrl: 'https://repo.test/e.js' }
    });

    expect(diagnostics.source).toMatchObject({ name: 'Example', version: '1.2.0' });
    expect(diagnostics.method).toBe('search');
  });

  it('diagnoses a file that is not a source at all', async () => {
    const diagnostics = await failing('<!doctype html><h1>404</h1>');
    expect(diagnostics.cause).toMatch(/could not be parsed/i);
    expect(diagnostics.fix).toMatch(/404 page/);
  });

  it('diagnoses a file with no DefaultExtension class', async () => {
    const diagnostics = await failing('const mangayomiSources = [{ name: "x" }];');
    expect(diagnostics.cause).toMatch(/declares no DefaultExtension/i);
  });
});

describe('excerpt', () => {
  it('does not run past the start or end of the file', () => {
    const code = 'line one\nline two';
    expect(excerpt(code, 1)[0].number).toBe(1);
    expect(excerpt(code, 2).slice(-1)[0].number).toBe(2);
  });

  it('returns nothing when there is no line to quote', () => {
    expect(excerpt('code', null)).toBeNull();
    expect(excerpt(null, 3)).toBeNull();
  });
});

/**
 * The failure the user actually hit: a source blocked by bot protection was
 * reported as "an error the app does not recognise", with the source's own
 * clear message printed directly beneath it.
 */
describe('a source blocked by the site\'s bot protection', () => {
  const { buildDiagnostics } = require('../extensions/diagnostics');

  const report = (message) => buildDiagnostics({
    message, stack: '', code: '', requests: [], logs: [], method: 'getPopular'
  });

  it('is recognised rather than falling through to the generic case', () => {
    const { cause } = report(
      'Re:ANIME refused the request (HTTP 403). Its bot protection rejects '
      + 'requests coming from the server Animiru runs on.'
    );

    expect(cause).not.toMatch(/does not recognise/);
    expect(cause).toMatch(/bot protection/i);
  });

  it('explains that the block is aimed at the server, not the reader', () => {
    const { fix } = report('AnimePahe: DDoS-Guard bot protection is challenging the request.');

    expect(fix).toMatch(/run on the Animiru server, not on your device/);
    expect(fix).toMatch(/Opening the site in your own browser does not help/);
  });

  it('recognises a bare 403 with no explanation attached', () => {
    const { cause, fix } = report('Re:ANIME responded 403 for https://reanime.to/popular');

    expect(cause).toMatch(/refused the request with 403/);
    expect(fix).toMatch(/hosting provider/);
  });

  it('still does not recognise a genuinely unknown failure', () => {
    expect(report('something nobody has seen before').cause)
      .toMatch(/does not recognise/);
  });
});
