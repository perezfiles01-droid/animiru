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

describe('GET /api/extensions/methods', () => {
  it('lists the callable methods', async () => {
    const res = await request(app).get('/api/extensions/methods');
    expect(res.status).toBe(200);
    expect(res.body.methods).toEqual(expect.arrayContaining(['search', 'getDetail', 'getVideoList']));
  });
});
