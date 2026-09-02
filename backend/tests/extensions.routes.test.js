/**
 * The extension routes, mounted on a bare app.
 *
 * The router is exercised in isolation rather than through server.js so
 * these tests do not need Firebase credentials to run.
 */

const express = require('express');
const request = require('supertest');

const repository = require('../extensions/repository');
const http = require('../extensions/http');

const app = express();
app.use(express.json());
app.use('/api/extensions', require('../routes/extensions'));

const INDEX_URL = 'https://repo.test/index.json';
const CODE = `
  const mangayomiSources = [{ name: "Example", id: 42, itemType: 1, baseUrl: "https://example.test" }];
  class DefaultExtension extends MProvider {
    async search(query, page) {
      return { list: [{ name: query + " " + page }], hasNextPage: false };
    }
  }
`;

describe('POST /api/extensions/repository', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns the sources a repository lists', async () => {
    jest.spyOn(http, 'request').mockResolvedValue({
      statusCode: 200,
      url: INDEX_URL,
      headers: {},
      body: JSON.stringify([{ name: 'Example', id: '42', itemType: 1, pkgPath: 'example.js' }])
    });

    const res = await request(app).post('/api/extensions/repository').send({ url: INDEX_URL });

    expect(res.status).toBe(200);
    expect(res.body.sources).toHaveLength(1);
    expect(res.body.sources[0].codeUrl).toBe('https://repo.test/example.js');
  });

  it('answers 400 for a missing URL', async () => {
    const res = await request(app).post('/api/extensions/repository').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/repository URL is required/);
  });

  it('answers 400 with the reason for an unreadable repository', async () => {
    const res = await request(app)
      .post('/api/extensions/repository')
      .send({ url: 'file:///etc/passwd' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unsupported protocol/);
  });
});

describe('POST /api/extensions/run', () => {
  beforeEach(() => repository.clearCache());
  afterEach(() => jest.restoreAllMocks());

  it('runs code supplied directly, as the maker does', async () => {
    const res = await request(app).post('/api/extensions/run').send({
      code: CODE,
      method: 'search',
      args: ['bleach', 2]
    });

    expect(res.status).toBe(200);
    expect(res.body.result).toEqual({ list: [{ name: 'bleach 2' }], hasNextPage: false });
    expect(res.body).toHaveProperty('durationMs');
  });

  it('runs an installed source by URL and merges its declared metadata', async () => {
    jest.spyOn(http, 'request').mockResolvedValue({
      statusCode: 200,
      url: 'https://repo.test/example.js',
      headers: {},
      body: `
        const mangayomiSources = [{ name: "Example", baseUrl: "https://declared.test" }];
        class DefaultExtension extends MProvider {
          async search() { return this.source.baseUrl; }
        }
      `
    });

    const res = await request(app).post('/api/extensions/run').send({
      codeUrl: 'https://repo.test/example.js',
      method: 'search',
      args: []
    });

    expect(res.status).toBe(200);
    expect(res.body.result).toBe('https://declared.test');
  });

  it('answers 422 with the logs and request trace when a source fails', async () => {
    const res = await request(app).post('/api/extensions/run').send({
      code: `
        class DefaultExtension extends MProvider {
          async search() {
            console.log("selector matched nothing");
            throw new Error("layout changed");
          }
        }
      `,
      method: 'search'
    });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/layout changed/);
    expect(res.body.logs[0].message).toBe('selector matched nothing');
  });

  it('refuses a method outside the contract', async () => {
    const res = await request(app)
      .post('/api/extensions/run')
      .send({ code: CODE, method: 'constructor' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Method must be one of/);
  });

  it('refuses a request with neither code nor codeUrl', async () => {
    const res = await request(app).post('/api/extensions/run').send({ method: 'search' });
    expect(res.status).toBe(400);
  });

  it('refuses args that are not an array', async () => {
    const res = await request(app)
      .post('/api/extensions/run')
      .send({ code: CODE, method: 'search', args: 'bleach' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/args must be an array/);
  });
});

/**
 * A refused request is not an error the caller can do nothing about: the
 * app can make that one request from the user's own connection, which is
 * not the datacenter address the site blocked.
 */
describe('POST /api/extensions/run, when the site refuses the server', () => {
  const BLOCKED = `
    const mangayomiSources = [{ name: "Blocked", id: 7, baseUrl: "https://site.test" }];
    class DefaultExtension extends MProvider {
      async search(query) {
        const res = await new Client().get("https://site.test/find?q=" + query);
        return { list: JSON.parse(res.body), hasNextPage: false };
      }
    }
  `;

  afterEach(() => jest.restoreAllMocks());

  const send = (body) => request(app).post('/api/extensions/run').send({
    code: BLOCKED, method: 'search', args: ['bleach'], ...body
  });

  it('answers 409 with the request the device should make', async () => {
    jest.spyOn(http, 'request').mockResolvedValue({
      statusCode: 403, headers: {}, url: 'https://site.test/find?q=bleach', body: ''
    });

    const res = await send({ allowHandoff: true });

    expect(res.status).toBe(409);
    expect(res.body.needsDeviceFetch).toMatchObject({
      refusedWith: 403,
      request: { method: 'GET', url: 'https://site.test/find?q=bleach' }
    });
    expect(res.body.needsDeviceFetch.key).toBeTruthy();
  });

  it('completes the run when the app sends back what it fetched', async () => {
    jest.spyOn(http, 'request').mockResolvedValue({
      statusCode: 403, headers: {}, url: 'https://site.test/find?q=bleach', body: ''
    });

    const first = await send({ allowHandoff: true });
    const res = await send({
      allowHandoff: true,
      fetched: {
        [first.body.needsDeviceFetch.key]: {
          statusCode: 200, body: '[{"name":"Bleach"}]', headers: {}, url: ''
        }
      }
    });

    expect(res.status).toBe(200);
    expect(res.body.result.list).toEqual([{ name: 'Bleach' }]);
  });

  // The key the app is given has to be the key the run looks the answer up
  // by, or every reply is ignored and the app loops asking for the same URL.
  it('accepts the key exactly as it handed it out', async () => {
    jest.spyOn(http, 'request').mockResolvedValue({
      statusCode: 403, headers: {}, url: 'https://site.test/find?q=bleach', body: ''
    });

    const { body } = await send({ allowHandoff: true });
    expect(body.needsDeviceFetch.key)
      .toBe('GET https://site.test/find?q=bleach');
  });

  /**
   * A handoff is normally answered by the app and never seen. When the
   * rounds run out it is the only thing in front of the user, and it used
   * to arrive carrying nothing - a sentence, no "Show details", no address.
   * The one question worth asking could not be answered from a screenshot.
   */
  describe('the trace it carries, for when the app gives up', () => {
    beforeEach(() => {
      jest.spyOn(http, 'request').mockResolvedValue({
        statusCode: 403, headers: {}, url: 'https://site.test/find?q=bleach', body: ''
      });
    });

    it('carries the requests the run made', async () => {
      const { body } = await send({ allowHandoff: true });

      expect(body.requests).toEqual([
        expect.objectContaining({ url: 'https://site.test/find?q=bleach', status: 403 })
      ]);
    });

    it('names the refused address in the advice', async () => {
      const { body } = await send({ allowHandoff: true });

      expect(body.diagnostics.fix).toContain('https://site.test/find?q=bleach');
    });

    // Without diagnostics the report renders a bare sentence with no way in.
    it('carries diagnostics, so the report can be opened', async () => {
      const { body } = await send({ allowHandoff: true });

      expect(body.diagnostics).toMatchObject({
        cause: expect.any(String),
        method: 'search',
        requests: expect.any(Array)
      });
    });

    it('marks the handed-off request as one that failed', async () => {
      const { body } = await send({ allowHandoff: true });
      expect(body.diagnostics.failedRequests).toHaveLength(1);
    });

    // The local `source` is declared inside the try; reading it from the
    // catch threw a ReferenceError and turned a handoff into a 500.
    it('names the source without reaching for an out-of-scope local', async () => {
      const res = await request(app).post('/api/extensions/run').send({
        code: BLOCKED,
        method: 'search',
        args: ['bleach'],
        allowHandoff: true,
        source: { name: 'Blocked', version: '1.2.0' }
      });

      expect(res.status).toBe(409);
      expect(res.body.diagnostics.source).toMatchObject({ name: 'Blocked', version: '1.2.0' });
    });
  });

  it('is an ordinary failure for a caller that cannot fetch', async () => {
    jest.spyOn(http, 'request').mockResolvedValue({
      statusCode: 403, headers: {}, url: 'https://site.test/find?q=bleach', body: ''
    });

    const res = await send({});

    expect(res.status).toBe(422);
    expect(res.body.needsDeviceFetch).toBeUndefined();
  });
});

describe('GET /api/extensions/methods', () => {
  it('lists the callable methods', async () => {
    const res = await request(app).get('/api/extensions/methods');
    expect(res.status).toBe(200);
    expect(res.body.methods).toEqual(expect.arrayContaining(['search', 'getDetail', 'getVideoList']));
  });
});

/**
 * A run reaching a source's other homes.
 *
 * The rotation itself is covered in extensions.mirrors.test.js. What these
 * check is that the route actually uses it, and hands back which home
 * worked - without which the app cannot remember, and a source whose home
 * is down pays the same failure on every screen.
 */
describe('POST /run against a source with mirrors', () => {
  const ROAMING = `
    const mangayomiSources = [{ name: 'Roaming', id: 91, version: '1.0.0' }];
    class DefaultExtension extends MProvider {
      async getPopular(page) {
        const res = await new Client().get(this.source.baseUrl + '/list');
        const names = res.body ? JSON.parse(res.body) : [];
        return { list: names.map((n) => ({ name: n, link: '' })), hasNextPage: false };
      }
      getSourcePreferences() { return []; }
    }
  `;

  const SOURCE = {
    name: 'Roaming',
    baseUrl: 'https://home.test',
    mirrors: ['https://one.test', 'https://two.test']
  };

  const serveByHost = (byHost) => {
    jest.spyOn(http, 'request').mockImplementation(async ({ url }) => {
      const answer = byHost[new URL(url).host];
      if (answer instanceof Error) throw answer;
      return { statusCode: 200, headers: {}, url, body: answer === undefined ? '[]' : answer };
    });
  };

  const down = () => Object.assign(new Error('timeout of 5000ms exceeded'), { code: 'ETIMEDOUT' });

  it('falls through to a mirror when the home is down', async () => {
    serveByHost({ 'home.test': down(), 'one.test': '["One Piece"]' });

    const { body } = await request(app)
      .post('/api/extensions/run')
      .send({ code: ROAMING, method: 'getPopular', args: [1], source: SOURCE })
      .expect(200);

    expect(body.result.list[0].name).toBe('One Piece');
  });

  it('says which home produced the answer', async () => {
    serveByHost({ 'home.test': down(), 'one.test': '["One Piece"]' });

    const { body } = await request(app)
      .post('/api/extensions/run')
      .send({ code: ROAMING, method: 'getPopular', args: [1], source: SOURCE })
      .expect(200);

    expect(body.baseUrl).toBe('https://one.test');
  });

  it('starts from the home the caller says worked last time', async () => {
    serveByHost({ 'home.test': '["Home"]', 'two.test': '["Two"]' });

    const { body } = await request(app)
      .post('/api/extensions/run')
      .send({
        code: ROAMING, method: 'getPopular', args: [1], source: SOURCE,
        preferredBaseUrl: 'https://two.test'
      })
      .expect(200);

    expect(body.result.list[0].name).toBe('Two');
    expect(body.baseUrl).toBe('https://two.test');
  });

  it('still reports a failure when no home works', async () => {
    serveByHost({ 'home.test': down(), 'one.test': down(), 'two.test': down() });

    const { body } = await request(app)
      .post('/api/extensions/run')
      .send({ code: ROAMING, method: 'getPopular', args: [1], source: SOURCE })
      .expect(422);

    expect(body.diagnostics).toBeTruthy();
  });
});

/**
 * Asking again without the home whose streams would not play.
 *
 * The rotation covers this; what matters here is that the route carries
 * the caller's list through, or the app can ask but never be heard.
 */
describe('POST /run ruling out a home', () => {
  const EPISODES = `
    const mangayomiSources = [{ name: 'Roaming', id: 92, version: '1.0.0' }];
    class DefaultExtension extends MProvider {
      async getVideoList(url) {
        const res = await new Client().get(this.source.baseUrl + '/ep');
        return res.body ? JSON.parse(res.body) : [];
      }
      getSourcePreferences() { return []; }
    }
  `;

  const SOURCE = {
    name: 'Roaming',
    baseUrl: 'https://home.test',
    mirrors: ['https://one.test']
  };

  it('skips it and returns the next home\'s streams', async () => {
    jest.spyOn(http, 'request').mockImplementation(async ({ url }) => ({
      statusCode: 200,
      headers: {},
      url,
      body: new URL(url).host === 'one.test' ? '[{"url":"https://cdn.test/a.m3u8"}]' : '[]'
    }));

    const { body } = await request(app)
      .post('/api/extensions/run')
      .send({
        code: EPISODES, method: 'getVideoList', args: ['/ep-1'], source: SOURCE,
        excludeBaseUrls: ['https://home.test']
      })
      .expect(200);

    expect(body.baseUrl).toBe('https://one.test');
    expect(body.result).toHaveLength(1);
  });

  it('says so when every home has been ruled out', async () => {
    jest.spyOn(http, 'request').mockResolvedValue({
      statusCode: 200, headers: {}, url: 'https://home.test/ep', body: '[]'
    });

    const { body } = await request(app)
      .post('/api/extensions/run')
      .send({
        code: EPISODES, method: 'getVideoList', args: ['/ep-1'], source: SOURCE,
        excludeBaseUrls: ['https://home.test', 'https://one.test']
      })
      .expect(422);

    expect(body.error).toMatch(/No other home left/);
  });
});
