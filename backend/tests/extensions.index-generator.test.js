/**
 * The index is generated from the source files rather than written by hand,
 * so these cover the two things that would make it wrong: reading a
 * declaration incorrectly, and letting a bad source through silently.
 */

const fs = require('fs');
const path = require('path');
const {
  build, serialise, toEntry, problemsWith, RAW_BASE
} = require('../../scripts/generate-extension-index');

const INDEX = path.join(__dirname, '..', '..', 'extensions', 'index.json');

describe('generating the extension index', () => {
  it('is in step with the sources on disk', () => {
    // The committed file is what users install from. If it drifts from the
    // sources, the app serves a source that no longer matches its entry.
    expect(fs.readFileSync(INDEX, 'utf8')).toBe(serialise(build()));
  });

  it('lists the Internet Archive source', () => {
    const entries = build();
    expect(entries).toEqual([expect.objectContaining({
      name: 'Internet Archive', id: 1001, itemType: 1
    })]);
  });

  // Animiru resolves a relative pkgPath; Mangayomi does not. A relative-only
  // entry makes the same repository work in one app and fail in the other.
  it('points at the code with an absolute URL, so Mangayomi can resolve it', () => {
    const [entry] = build();
    expect(entry.sourceCodeUrl).toBe(`${RAW_BASE}/archive-org.js`);
    expect(entry.sourceCodeUrl).toMatch(/^https:\/\//);
    expect(entry.pkgPath).toBe('sources/archive-org.js');
  });

  it('fills in the defaults Mangayomi expects', () => {
    const entry = toEntry({ name: 'X', id: 7, baseUrl: 'https://x.test', version: '1.0.0' }, 'x.js');
    expect(entry).toMatchObject({
      lang: 'en', itemType: 1, isManga: false, isNsfw: false,
      hasCloudflare: false, typeSource: 'single', apiUrl: ''
    });
  });

  it('marks a manga source as one', () => {
    expect(toEntry({ name: 'M', id: 8, baseUrl: 'https://m.test', version: '1', itemType: 0 }, 'm.js'))
      .toMatchObject({ itemType: 0, isManga: true });
  });
});

describe('refusing a source that would install badly', () => {
  it.each([
    [{ id: 1, baseUrl: 'https://x.test', version: '1' }, /no "name"/],
    [{ name: 'X', baseUrl: 'https://x.test', version: '1' }, /"id" must be a whole number/],
    [{ name: 'X', id: '1', baseUrl: 'https://x.test', version: '1' }, /"id" must be a whole number/],
    [{ name: 'X', id: 1, version: '1' }, /no "baseUrl"/],
    [{ name: 'X', id: 1, baseUrl: 'https://x.test' }, /no "version"/]
  ])('rejects %j', (declared, pattern) => {
    expect(problemsWith(declared, 'x.js').join('\n')).toMatch(pattern);
  });

  it('reports every problem at once rather than one per push', () => {
    expect(problemsWith({}, 'x.js')).toHaveLength(4);
  });

  it('says so when the declaration is not an object at all', () => {
    expect(problemsWith(null, 'x.js')).toEqual([expect.stringMatching(/does not declare an object/)]);
  });
});

/**
 * The generated file is only useful if the app can actually install from it,
 * so this runs it through the real repository parser rather than inspecting
 * the JSON and calling that proof.
 */
describe('installing from the generated index', () => {
  const http = require('../extensions/http');
  const repository = require('../extensions/repository');

  const INDEX_URL =
    'https://raw.githubusercontent.com/perezfiles01-droid/animiru/main/extensions/index.json';

  afterEach(() => {
    jest.restoreAllMocks();
    repository.clearCache();
  });

  it('is accepted whole, with no entry dropped', async () => {
    const body = fs.readFileSync(INDEX, 'utf8');
    jest.spyOn(http, 'request').mockResolvedValue({
      status: 200, statusCode: 200, headers: { 'content-type': 'application/json' }, body
    });

    const repo = await repository.fetchIndex(INDEX_URL);

    // A rejected entry is the failure that matters: it installs cleanly and
    // then shows nothing, which reads as a broken app rather than a bad entry.
    expect(repo.rejected || []).toEqual([]);
    expect(repo.sources).toHaveLength(JSON.parse(body).length);
    expect(repo.sources[0]).toMatchObject({
      name: 'Internet Archive',
      codeUrl: `${RAW_BASE}/archive-org.js`
    });
  });

  it('serves the source code the entry points at', async () => {
    const code = fs.readFileSync(
      path.join(__dirname, '..', '..', 'extensions', 'sources', 'archive-org.js'), 'utf8'
    );
    jest.spyOn(http, 'request').mockResolvedValue({
      status: 200, statusCode: 200, headers: {}, body: code
    });

    const fetched = await repository.fetchSourceCode(`${RAW_BASE}/archive-org.js`, { version: '1.0.0' });
    expect(String(fetched.code ?? fetched)).toContain('class DefaultExtension');
  });
});
