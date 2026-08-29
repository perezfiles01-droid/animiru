/**
 * Repository handling is where malformed third-party data arrives, so these
 * tests are mostly about what happens when an index is wrong rather than
 * when it is right.
 */

const repository = require('../extensions/repository');
const http = require('../extensions/http');

const INDEX_URL = 'https://repo.test/anime/index.json';

function entry(overrides = {}) {
  return {
    name: 'Example',
    id: '42',
    lang: 'EN',
    baseUrl: 'https://example.test',
    iconUrl: 'https://repo.test/icon.png',
    version: '1.2.0',
    itemType: 1,
    pkgPath: 'src/example.js',
    ...overrides
  };
}

describe('validateEntry', () => {
  it('normalises a well-formed entry', () => {
    const outcome = repository.validateEntry(entry(), INDEX_URL);
    expect(outcome.ok).toBe(true);
    expect(outcome.source).toMatchObject({
      id: '42',
      name: 'Example',
      lang: 'en',
      version: '1.2.0',
      codeUrl: 'https://repo.test/anime/src/example.js',
      repoUrl: INDEX_URL,
      isNsfw: false,
      isMetadataCapable: true
    });
  });

  it('scopes the source key by repository, so two repos can share an id', () => {
    const a = repository.validateEntry(entry(), 'https://a.test/index.json');
    const b = repository.validateEntry(entry(), 'https://b.test/index.json');
    expect(a.source.key).not.toBe(b.source.key);
  });

  it('prefers an explicit sourceCodeUrl over pkgPath', () => {
    const outcome = repository.validateEntry(
      entry({ sourceCodeUrl: 'https://cdn.test/example.js' }),
      INDEX_URL
    );
    expect(outcome.source.codeUrl).toBe('https://cdn.test/example.js');
  });

  it('resolves pkgPath relative to the index', () => {
    const outcome = repository.validateEntry(
      entry({ pkgPath: '../shared/example.js' }),
      'https://repo.test/anime/en/index.json'
    );
    expect(outcome.source.codeUrl).toBe('https://repo.test/anime/shared/example.js');
  });

  it('defaults an absent itemType to anime', () => {
    const withoutType = entry();
    delete withoutType.itemType;
    expect(repository.validateEntry(withoutType, INDEX_URL).ok).toBe(true);
  });

  it('skips manga and novel sources rather than failing', () => {
    const outcome = repository.validateEntry(entry({ itemType: 0 }), INDEX_URL);
    expect(outcome).toMatchObject({ ok: false, reason: 'Source is not an anime source' });
  });

  it('rejects an entry with no name', () => {
    expect(repository.validateEntry(entry({ name: '  ' }), INDEX_URL).ok).toBe(false);
  });

  it('rejects an entry with nowhere to fetch code from', () => {
    const bare = entry();
    delete bare.pkgPath;
    expect(repository.validateEntry(bare, INDEX_URL))
      .toMatchObject({ ok: false, reason: expect.stringContaining('no usable sourceCodeUrl') });
  });

  it('rejects a code URL that is not http', () => {
    const outcome = repository.validateEntry(
      entry({ sourceCodeUrl: 'file:///etc/passwd' }),
      INDEX_URL
    );
    expect(outcome).toMatchObject({ ok: false, reason: expect.stringContaining('Unsupported protocol') });
  });

  it('rejects a baseUrl that is not http', () => {
    const outcome = repository.validateEntry(entry({ baseUrl: 'javascript:alert(1)' }), INDEX_URL);
    expect(outcome).toMatchObject({ ok: false, reason: expect.stringContaining('Invalid baseUrl') });
  });

  it('rejects a non-object entry', () => {
    expect(repository.validateEntry('nope', INDEX_URL).ok).toBe(false);
    expect(repository.validateEntry(null, INDEX_URL).ok).toBe(false);
    expect(repository.validateEntry([], INDEX_URL).ok).toBe(false);
  });

  it('honours a source that declares it carries no metadata', () => {
    const outcome = repository.validateEntry(entry({ isMetadataCapable: false }), INDEX_URL);
    expect(outcome.source.isMetadataCapable).toBe(false);
  });
});

describe('fetchIndex', () => {
  let requestSpy;

  function respond(body, { status = 200, url = INDEX_URL } = {}) {
    requestSpy.mockResolvedValue({
      statusCode: status,
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: {},
      url
    });
  }

  beforeEach(() => {
    requestSpy = jest.spyOn(http, 'request');
    repository.clearCache();
  });

  afterEach(() => {
    requestSpy.mockRestore();
  });

  it('returns the usable sources and reports the rest', async () => {
    respond([
      entry({ name: 'Good' }),
      entry({ name: 'Manga', id: '2', itemType: 0 }),
      { name: 'Broken', id: '3' }
    ]);

    const { sources, skipped } = await repository.fetchIndex(INDEX_URL);

    expect(sources.map((s) => s.name)).toEqual(['Good']);
    expect(skipped).toEqual([
      { name: 'Manga', reason: 'Source is not an anime source' },
      { name: 'Broken', reason: 'Entry has no usable sourceCodeUrl or pkgPath' }
    ]);
  });

  it('drops a duplicate id rather than installing over itself', async () => {
    respond([entry({ name: 'First' }), entry({ name: 'Second' })]);
    const { sources, skipped } = await repository.fetchIndex(INDEX_URL);
    expect(sources).toHaveLength(1);
    expect(skipped[0].reason).toBe('Duplicate source id in repository');
  });

  it('resolves paths against the URL it was finally served from', async () => {
    // A GitHub raw URL that redirects still has to yield correct code URLs.
    respond([entry()], { url: 'https://cdn.repo.test/anime/index.json' });
    const { sources } = await repository.fetchIndex(INDEX_URL);
    expect(sources[0].codeUrl).toBe('https://cdn.repo.test/anime/src/example.js');
  });

  it('explains a non-JSON index', async () => {
    respond('<html>404</html>');
    await expect(repository.fetchIndex(INDEX_URL)).rejects.toThrow(/not valid JSON/);
  });

  it('explains an index that is not an array', async () => {
    respond({ sources: [] });
    await expect(repository.fetchIndex(INDEX_URL)).rejects.toThrow(/must be an array/);
  });

  it('explains a failing status', async () => {
    respond([], { status: 404 });
    await expect(repository.fetchIndex(INDEX_URL)).rejects.toThrow(/responded 404/);
  });

  it('refuses an oversized index', async () => {
    respond(`[${'"xxxxxxxxxx",'.repeat(200000)}"x"]`);
    await expect(repository.fetchIndex(INDEX_URL)).rejects.toThrow(/exceeds/);
  });

  it('refuses a repository listing implausibly many sources', async () => {
    respond(new Array(600).fill(0).map((_, i) => entry({ id: String(i) })));
    await expect(repository.fetchIndex(INDEX_URL)).rejects.toThrow(/more than/);
  });

  it('refuses a repository URL that is not http', async () => {
    await expect(repository.fetchIndex('file:///etc/passwd')).rejects.toThrow(/Unsupported protocol/);
    expect(requestSpy).not.toHaveBeenCalled();
  });
});

describe('fetchSourceCode', () => {
  const CODE_URL = 'https://repo.test/anime/src/example.js';
  const CODE = `
    const mangayomiSources = [{ name: "Example", id: 42, itemType: 1 }];
    class DefaultExtension extends MProvider {
      async search() { return { list: [], hasNextPage: false }; }
    }
  `;

  let requestSpy;

  beforeEach(() => {
    requestSpy = jest.spyOn(http, 'request');
    repository.clearCache();
  });

  afterEach(() => requestSpy.mockRestore());

  it('returns the code and the metadata the file declares', async () => {
    requestSpy.mockResolvedValue({ statusCode: 200, body: CODE, headers: {}, url: CODE_URL });
    const fetched = await repository.fetchSourceCode(CODE_URL, { version: '1.0.0' });

    expect(fetched.code).toBe(CODE);
    expect(fetched.sources[0]).toMatchObject({ name: 'Example', id: 42 });
    expect(fetched.cached).toBe(false);
  });

  it('serves a second read from cache', async () => {
    requestSpy.mockResolvedValue({ statusCode: 200, body: CODE, headers: {}, url: CODE_URL });

    await repository.fetchSourceCode(CODE_URL, { version: '1.0.0' });
    const second = await repository.fetchSourceCode(CODE_URL, { version: '1.0.0' });

    expect(second.cached).toBe(true);
    expect(requestSpy).toHaveBeenCalledTimes(1);
  });

  it('refetches when the version changes, so a bump takes effect', async () => {
    requestSpy.mockResolvedValue({ statusCode: 200, body: CODE, headers: {}, url: CODE_URL });

    await repository.fetchSourceCode(CODE_URL, { version: '1.0.0' });
    await repository.fetchSourceCode(CODE_URL, { version: '1.1.0' });

    expect(requestSpy).toHaveBeenCalledTimes(2);
  });

  it('refetches when asked to refresh', async () => {
    requestSpy.mockResolvedValue({ statusCode: 200, body: CODE, headers: {}, url: CODE_URL });

    await repository.fetchSourceCode(CODE_URL, { version: '1.0.0' });
    const refreshed = await repository.fetchSourceCode(CODE_URL, { version: '1.0.0', refresh: true });

    expect(refreshed.cached).toBe(false);
    expect(requestSpy).toHaveBeenCalledTimes(2);
  });

  it('rejects a 404 page served where code was expected', async () => {
    requestSpy.mockResolvedValue({
      statusCode: 200,
      body: '<!doctype html><h1>Not Found</h1>',
      headers: {},
      url: CODE_URL
    });
    await expect(repository.fetchSourceCode(CODE_URL)).rejects.toThrow(/not a valid extension/);
  });

  it('explains a failing status', async () => {
    requestSpy.mockResolvedValue({ statusCode: 500, body: '', headers: {}, url: CODE_URL });
    await expect(repository.fetchSourceCode(CODE_URL)).rejects.toThrow(/responded 500/);
  });
});
