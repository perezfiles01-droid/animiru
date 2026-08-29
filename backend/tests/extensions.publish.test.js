/**
 * Publishing writes to a repository with our token, so the tests that
 * matter are the ones about who may do it and what gets committed.
 */

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const publish = require('../extensions/publish');

jest.mock('axios');

const JWT_SECRET = 'test-secret';
const AUTHOR = 'author@example.com';

const CODE = `
  const mangayomiSources = [{
    name: "Example", id: 42, lang: "en",
    baseUrl: "https://example.test", version: "1.2.0", itemType: 1
  }];
  class DefaultExtension extends MProvider {
    async search() { return { list: [], hasNextPage: false }; }
  }
`;

const app = express();
app.use(express.json());
app.use('/api/extensions', require('../routes/extensions'));

function token(email = AUTHOR) {
  return jwt.sign({ email }, JWT_SECRET);
}

function post(body, auth = token()) {
  const req = request(app).post('/api/extensions/publish');
  if (auth) req.set('Authorization', `Bearer ${auth}`);
  return req.send(body);
}

/**
 * Answers GitHub's contents API: reads 404 unless a file is registered,
 * writes succeed and record what was sent.
 */
function mockGithub({ existing = {} } = {}) {
  const written = [];

  axios.mockImplementation(async ({ url, method, data }) => {
    const path = decodeURI(url.split('/contents/')[1].split('?')[0]);

    if (method === 'PUT') {
      written.push({ path, ...data, decoded: Buffer.from(data.content, 'base64').toString('utf8') });
      return { status: existing[path] ? 200 : 201, data: { content: { sha: 'new-sha' } } };
    }

    if (!existing[path]) return { status: 404, data: { message: 'Not Found' } };
    return {
      status: 200,
      data: {
        sha: `sha-${path}`,
        content: Buffer.from(existing[path], 'utf8').toString('base64')
      }
    };
  });

  return written;
}

describe('publishing', () => {
  beforeEach(() => {
    axios.mockReset();
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.GITHUB_TOKEN = 'gh-token';
    process.env.EXTENSION_REPO = 'me/animiru-extensions';
    process.env.EXTENSION_SOURCES_DIR = 'sources';
    process.env.EXTENSION_INDEX_PATH = 'index.json';
    process.env.EXTENSION_AUTHORS = AUTHOR;
  });

  describe('who may publish', () => {
    it('refuses an unsigned request', async () => {
      const res = await post({ fileName: 'a.js', code: CODE }, null);
      expect(res.status).toBe(401);
      expect(axios).not.toHaveBeenCalled();
    });

    it('refuses a token this server did not sign', async () => {
      const res = await post({ fileName: 'a.js', code: CODE }, jwt.sign({ email: AUTHOR }, 'other'));
      expect(res.status).toBe(401);
    });

    it('refuses an account that is not on the allowlist', async () => {
      const res = await post({ fileName: 'a.js', code: CODE }, token('someone@else.test'));
      expect(res.status).toBe(403);
      expect(axios).not.toHaveBeenCalled();
    });

    it('refuses everyone when the allowlist is empty', async () => {
      process.env.EXTENSION_AUTHORS = '';
      const res = await post({ fileName: 'a.js', code: CODE });
      expect(res.status).toBe(403);
    });

    it('matches an allowlisted address regardless of case', async () => {
      process.env.EXTENSION_AUTHORS = 'Author@Example.com';
      mockGithub();
      const res = await post({ fileName: 'a.js', code: CODE });
      expect(res.status).toBe(201);
    });
  });

  describe('what may be published', () => {
    beforeEach(() => mockGithub());

    it.each([
      ['../escape.js', 'a path that climbs out of the sources directory'],
      ['sub/dir.js', 'a path with a directory in it'],
      ['source.txt', 'a name that is not javascript'],
      ['.hidden.js', 'a dotfile']
    ])('refuses %s - %s', async (fileName) => {
      const res = await post({ fileName, code: CODE });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/File name must be/);
    });

    it('lowercases a name rather than rejecting it', async () => {
      // Case-insensitive filesystems make Source.js and source.js collide,
      // so the name is normalised once here instead of once per checkout.
      const written = mockGithub();
      const res = await post({ fileName: 'Source.JS', code: CODE });

      expect(res.status).toBe(201);
      expect(res.body.path).toBe('sources/source.js');
      expect(written[0].path).toBe('sources/source.js');
    });

    it('refuses code that does not parse', async () => {
      const res = await post({ fileName: 'a.js', code: 'class {{{' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/does not load/);
    });

    it('refuses a file that declares no source', async () => {
      const res = await post({ fileName: 'a.js', code: 'const x = 1;' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/declares no mangayomiSources/);
    });

    it('refuses an empty draft', async () => {
      const res = await post({ fileName: 'a.js', code: '   ' });
      expect(res.status).toBe(400);
    });

    it('answers 503 when the server has no repository configured', async () => {
      delete process.env.EXTENSION_REPO;
      const res = await post({ fileName: 'a.js', code: CODE });
      expect(res.status).toBe(503);
    });
  });

  describe('what gets committed', () => {
    it('writes the source and an index entry built from what it declares', async () => {
      const written = mockGithub();

      const res = await post({ fileName: 'example.js', code: CODE });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ path: 'sources/example.js', created: true });

      const [source, index] = written;
      expect(source.path).toBe('sources/example.js');
      expect(source.decoded).toBe(CODE);
      expect(source.message).toContain('Add Example v1.2.0');
      expect(source.message).toContain(AUTHOR);

      expect(index.path).toBe('index.json');
      expect(JSON.parse(index.decoded)).toEqual([{
        name: 'Example',
        id: 42,
        lang: 'en',
        baseUrl: 'https://example.test',
        apiUrl: '',
        iconUrl: '',
        version: '1.2.0',
        itemType: 1,
        isNsfw: false,
        hasCloudflare: false,
        isMetadataCapable: true,
        pkgPath: 'sources/example.js'
      }]);
    });

    it('updates an existing source in place and sends its sha', async () => {
      const written = mockGithub({
        existing: {
          'sources/example.js': 'old code',
          'index.json': JSON.stringify([
            { name: 'Example', version: '1.0.0', pkgPath: 'sources/example.js' }
          ])
        }
      });

      const res = await post({ fileName: 'example.js', code: CODE });

      expect(res.status).toBe(200);
      expect(res.body.created).toBe(false);

      const [source, index] = written;
      expect(source.sha).toBe('sha-sources/example.js');
      expect(source.message).toContain('Update Example');

      // Replaced, not appended - otherwise the index grows a duplicate on
      // every republish.
      const entries = JSON.parse(index.decoded);
      expect(entries).toHaveLength(1);
      expect(entries[0].version).toBe('1.2.0');
    });

    it('keeps other sources in the index untouched', async () => {
      const written = mockGithub({
        existing: {
          'index.json': JSON.stringify([
            { name: 'Other', version: '3.0.0', pkgPath: 'sources/other.js' }
          ])
        }
      });

      await post({ fileName: 'example.js', code: CODE });

      const entries = JSON.parse(written[1].decoded);
      expect(entries.map((e) => e.pkgPath)).toEqual(['sources/other.js', 'sources/example.js']);
    });

    it('reports a concurrent write rather than clobbering it', async () => {
      axios.mockImplementation(async ({ method }) => {
        if (method === 'PUT') {
          return { status: 409, data: { message: 'sha does not match' } };
        }
        return { status: 404, data: { message: 'Not Found' } };
      });

      const res = await post({ fileName: 'example.js', code: CODE });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/changed while you were publishing/);
    });

    it('refuses to rewrite an index that is not valid JSON', async () => {
      mockGithub({ existing: { 'index.json': 'not json' } });
      const res = await post({ fileName: 'example.js', code: CODE });
      expect(res.status).toBe(502);
      expect(res.body.error).toMatch(/not valid JSON/);
    });
  });

  describe('GET /publish', () => {
    it('reports that publishing is available', async () => {
      const res = await request(app).get('/api/extensions/publish');
      expect(res.body).toEqual({ configured: true });
    });

    it('reports that it is not, so the maker can hide the button', async () => {
      delete process.env.GITHUB_TOKEN;
      const res = await request(app).get('/api/extensions/publish');
      expect(res.body).toEqual({ configured: false });
    });
  });
});

describe('upsertEntry', () => {
  it('appends an entry the index does not have', () => {
    expect(publish.upsertEntry([], { pkgPath: 'a.js' })).toEqual([{ pkgPath: 'a.js' }]);
  });

  it('replaces by path rather than by name', () => {
    const index = [{ pkgPath: 'a.js', name: 'Old' }];
    expect(publish.upsertEntry(index, { pkgPath: 'a.js', name: 'New' }))
      .toEqual([{ pkgPath: 'a.js', name: 'New' }]);
  });

  it('tolerates an index that is not an array', () => {
    expect(publish.upsertEntry(null, { pkgPath: 'a.js' })).toEqual([{ pkgPath: 'a.js' }]);
  });
});
