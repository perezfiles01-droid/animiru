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
