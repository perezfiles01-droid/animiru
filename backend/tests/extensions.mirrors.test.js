/**
 * Trying a source's other homes when its usual one will not do.
 *
 * The rule that matters: a mirror is accepted on what it PRODUCES, not on
 * whether it answered. A domain listed by mistake - somebody else's site -
 * returns HTTP 200 and parses to nothing, so accepting on status would pick
 * it, show an empty screen and call that success.
 */

const { runWithMirrors, homes } = require('../extensions/mirrors');
const { DeviceFetchRequired } = require('../extensions/handoff');
const http = require('../extensions/http');

const CODE = `
  const mangayomiSources = [{ name: 'Roaming', id: 9, version: '1.0.0' }];
  class DefaultExtension extends MProvider {
    async getPopular(page) {
      const res = await new Client().get(this.source.baseUrl + '/list');
      const names = res.body ? JSON.parse(res.body) : [];
      return { list: names.map((n) => ({ name: n, link: this.source.baseUrl })), hasNextPage: false };
    }
    async search(query, page, filters) {
      const res = await new Client().get(this.source.baseUrl + '/search');
      const names = res.body ? JSON.parse(res.body) : [];
      return { list: names.map((n) => ({ name: n, link: '' })), hasNextPage: false };
    }
    getSourcePreferences() { return []; }
  }
`;

/**
 * @param {Object} byHost host -> body, or an Error to throw for that host
 */
function serve(byHost) {
  const asked = [];
  jest.spyOn(http, 'request').mockImplementation(async ({ url }) => {
    const host = new URL(url).host;
    asked.push(host);
    const answer = byHost[host];
    if (answer instanceof Error) throw answer;
    return { statusCode: 200, headers: {}, url, body: answer === undefined ? '[]' : answer };
  });
  return asked;
}

const SOURCE = {
  name: 'Roaming',
  baseUrl: 'https://home.test',
  mirrors: ['https://one.test', 'https://two.test', 'https://three.test']
};

const run = (options) => runWithMirrors({
  code: CODE, method: 'getPopular', args: [1], source: SOURCE, ...options
});

const down = () => Object.assign(new Error('timeout of 5000ms exceeded'), { code: 'ETIMEDOUT' });

afterEach(() => jest.restoreAllMocks());

describe('when the source\'s own home works', () => {
  it('uses it and asks nobody else', async () => {
    const asked = serve({ 'home.test': '["One Piece"]' });
    const outcome = await run({});

    expect(outcome.result.list[0].name).toBe('One Piece');
    expect(asked).toEqual(['home.test']);
  });

  it('names the home that answered', async () => {
    serve({ 'home.test': '["One Piece"]' });
    expect((await run({})).baseUrl).toBe('https://home.test');
  });
});

describe('when the home cannot be reached', () => {
  it('tries the next one and uses what it produces', async () => {
    const asked = serve({ 'home.test': down(), 'one.test': '["Naruto"]' });
    const outcome = await run({});

    expect(outcome.result.list[0].name).toBe('Naruto');
    expect(outcome.baseUrl).toBe('https://one.test');
    expect(asked).toEqual(['home.test', 'one.test']);
  });

  it('keeps going past a mirror that is also down', async () => {
    serve({ 'home.test': down(), 'one.test': down(), 'two.test': '["Bleach"]' });
    expect((await run({})).baseUrl).toBe('https://two.test');
  });

  // Three whole runs is already most of the run budget.
  it('gives up after three, however many are listed', async () => {
    const asked = serve({ 'home.test': down(), 'one.test': down(), 'two.test': down() });

    await expect(run({})).rejects.toThrow();
    expect(asked).toEqual(['home.test', 'one.test', 'two.test']);
  });

  // The home's failure is the one worth reporting; the rest are consolation.
  it('reports the first failure, not the last', async () => {
    serve({
      'home.test': Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
      'one.test': down(),
      'two.test': down()
    });

    await expect(run({})).rejects.toThrow(/ECONNRESET/);
  });
});

describe('a mirror that answers but is not the right site', () => {
  // The case the whole design turns on: 200, parses to nothing.
  it('is skipped rather than shown as an empty screen', async () => {
    const asked = serve({ 'home.test': down(), 'one.test': '[]', 'two.test': '["One Piece"]' });
    const outcome = await run({});

    expect(outcome.result.list[0].name).toBe('One Piece');
    expect(outcome.baseUrl).toBe('https://two.test');
    expect(asked).toContain('one.test');
  });

  it('is still returned when nothing better exists', async () => {
    serve({ 'home.test': '[]', 'one.test': '[]', 'two.test': '[]' });
    const outcome = await run({});

    expect(outcome.result.list).toEqual([]);
    expect(outcome.baseUrl).toBe('https://home.test');
  });
});

describe('an empty search', () => {
  // "No anime by that name" is the truth, not a broken mirror. Rotating
  // would make no-results the slowest screen in the app.
  it('is taken at its word', async () => {
    const asked = serve({ 'home.test': '[]', 'one.test': '["Wrong"]' });
    const outcome = await run({ method: 'search', args: ['nothing', 1, []] });

    expect(outcome.result.list).toEqual([]);
    expect(asked).toEqual(['home.test']);
  });
});

describe('the home that worked last time', () => {
  it('is tried first', async () => {
    const asked = serve({ 'home.test': '["Home"]', 'two.test': '["Two"]' });
    const outcome = await run({ preferredBaseUrl: 'https://two.test' });

    expect(outcome.result.list[0].name).toBe('Two');
    expect(asked).toEqual(['two.test']);
  });

  it('does not stop the others being tried when it fails', async () => {
    const asked = serve({ 'two.test': down(), 'home.test': '["Home"]' });
    const outcome = await run({ preferredBaseUrl: 'https://two.test' });

    expect(outcome.baseUrl).toBe('https://home.test');
    expect(asked).toEqual(['two.test', 'home.test']);
  });
});

describe('a site that refuses the server', () => {
  // An instruction to the app, not a verdict on this home: the device
  // fetches it and the run is replayed. Rotating instead would abandon the
  // source's own home for a mirror it did not need.
  it('is handed back rather than rotated past', async () => {
    jest.spyOn(http, 'request').mockResolvedValue({
      statusCode: 403, headers: {}, url: 'https://home.test/list', body: ''
    });

    await expect(run({ allowHandoff: true })).rejects.toBeInstanceOf(DeviceFetchRequired);
  });
});

describe('reading a mirror list', () => {
  it('starts with the source\'s own home', () => {
    expect(homes({ baseUrl: 'https://a.test', mirrors: ['https://b.test'] }))
      .toEqual(['https://a.test', 'https://b.test']);
  });

  it('puts a known-good home first', () => {
    expect(homes({ baseUrl: 'https://a.test', mirrors: ['https://b.test'] }, 'https://b.test'))
      .toEqual(['https://b.test', 'https://a.test']);
  });

  it('lists a home once, however it is written', () => {
    expect(homes({ baseUrl: 'https://a.test', mirrors: ['https://a.test/', 'https://a.test'] }))
      .toEqual(['https://a.test']);
  });

  // A mirror list is written by hand, and a typo must not become a request.
  it.each([['not a url'], ['ftp://a.test'], [''], [null], [42]])('drops %p', (bad) => {
    expect(homes({ baseUrl: 'https://a.test', mirrors: [bad] })).toEqual(['https://a.test']);
  });

  it('copes with a source that names no mirrors at all', () => {
    expect(homes({ baseUrl: 'https://a.test' })).toEqual(['https://a.test']);
  });
});

/**
 * An episode that yields no servers.
 *
 * The player already tries every server it is handed and says "no other
 * server worked" once they are all dead. That message is also what a user
 * sees when there were none to begin with - and in that case there was
 * never anything to try.
 *
 * Whether the home is incomplete or merely stale, nothing on it can play,
 * so another home is the only thing that can help. An empty search is still
 * taken at its word; an empty episode is not.
 */
describe('a home with no streams for the episode', () => {
  const EPISODES = `
    const mangayomiSources = [{ name: 'Roaming', id: 9, version: '1.0.0' }];
    class DefaultExtension extends MProvider {
      async getVideoList(url) {
        const res = await new Client().get(this.source.baseUrl + '/ep');
        return res.body ? JSON.parse(res.body) : [];
      }
      getSourcePreferences() { return []; }
    }
  `;

  const streams = (options) => runWithMirrors({
    code: EPISODES, method: 'getVideoList', args: ['/watch/x/ep-1'],
    source: SOURCE, ...options
  });

  it('is passed over for one that has them', async () => {
    const asked = serve({ 'home.test': '[]', 'one.test': '[{"url":"https://cdn.test/a.m3u8"}]' });
    const result = (await streams({})).result;

    expect(result).toHaveLength(1);
    expect(asked).toEqual(['home.test', 'one.test']);
  });

  it('names the home the streams came from', async () => {
    serve({ 'home.test': '[]', 'one.test': '[{"url":"https://cdn.test/a.m3u8"}]' });
    expect((await streams({})).baseUrl).toBe('https://one.test');
  });

  // Nothing anywhere is still an answer, and the player says so.
  it('gives back the empty list when no home has the episode', async () => {
    serve({ 'home.test': '[]', 'one.test': '[]', 'two.test': '[]' });
    expect((await streams({})).result).toEqual([]);
  });

  // The distinction that keeps no-results fast.
  it('does not change how an empty search is treated', async () => {
    const asked = serve({ 'home.test': '[]', 'one.test': '["Wrong"]' });
    await runWithMirrors({
      code: CODE, method: 'search', args: ['nothing', 1, []], source: SOURCE
    });

    expect(asked).toEqual(['home.test']);
  });
});
