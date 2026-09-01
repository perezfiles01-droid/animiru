/**
 * Running a method against a chosen base URL.
 *
 * A source reads its own home from the entry it is handed. Rotating to a
 * mirror could be done by editing that entry, but the entry is the
 * source's description of itself and a rotation is a decision about one
 * attempt - so the chosen base URL is its own field, applied after the
 * entry is assembled, and it wins.
 *
 * Passing nothing changes nothing, which is what lets this be added under
 * every existing caller without touching any of them.
 */

const { runExtension } = require('../extensions');
const http = require('../extensions/http');

const CODE = `
  const mangayomiSources = [{
    name: 'Declared', id: 7, version: '1.0.0', baseUrl: 'https://declared.test'
  }];
  class DefaultExtension extends MProvider {
    async getPopular(page) {
      const res = await new Client().get(this.source.baseUrl + '/list');
      return { list: [{ name: res.body, link: this.source.baseUrl }], hasNextPage: false };
    }
    getSourcePreferences() { return []; }
  }
`;

/** Answers with whichever host was asked, so the result names it. */
function serve() {
  const asked = [];
  jest.spyOn(http, 'request').mockImplementation(async ({ url }) => {
    asked.push(url);
    return { statusCode: 200, headers: {}, url, body: new URL(url).host };
  });
  return asked;
}

const run = (options) => runExtension({
  code: CODE, method: 'getPopular', args: [1], ...options
});

afterEach(() => jest.restoreAllMocks());

describe('choosing which base URL a run uses', () => {
  it('uses the entry it was handed when nothing is chosen', async () => {
    const asked = serve();
    await run({ source: { name: 'Entry', baseUrl: 'https://entry.test' } });

    expect(asked[0]).toBe('https://entry.test/list');
  });

  it('uses the chosen base URL when one is given', async () => {
    const asked = serve();
    await run({ source: { baseUrl: 'https://entry.test' }, baseUrl: 'https://mirror.test' });

    expect(asked[0]).toBe('https://mirror.test/list');
  });

  // The source sees it as its own baseUrl, so every link it builds - not
  // only the request - is on the mirror.
  it('is what the source reads as its own base', async () => {
    serve();
    const { result } = await run({
      source: { baseUrl: 'https://entry.test' }, baseUrl: 'https://mirror.test'
    });

    expect(result.list[0].link).toBe('https://mirror.test');
  });

  // Anything that is not a usable URL string leaves the run exactly as it
  // was, rather than sending it somewhere unintended.
  it.each([[''], [null], [undefined], [42]])('ignores %p and keeps the entry', async (bad) => {
    const asked = serve();
    await run({ source: { baseUrl: 'https://entry.test' }, baseUrl: bad });

    expect(asked[0]).toBe('https://entry.test/list');
  });
});
