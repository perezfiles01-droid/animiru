/**
 * The index is generated from the source files rather than written by hand,
 * so these cover the two things that would make it wrong: reading a
 * declaration incorrectly, and letting a bad source through silently.
 */

const fs = require('fs');
const path = require('path');
const {
  build, serialise, toEntry, problemsWith, RAW_BASE, OUTPUTS
} = require('../../scripts/generate-extension-index');

const INDEX = path.join(__dirname, '..', '..', 'extensions', 'index.json');
const SOURCES = path.join(__dirname, '..', '..', 'extensions', 'sources');

describe('generating the extension index', () => {
  it('is in step with the sources on disk', () => {
    // The committed file is what users install from. If it drifts from the
    // sources, the app serves a source that no longer matches its entry.
    expect(fs.readFileSync(INDEX, 'utf8')).toBe(serialise(build()));
  });

  // Named sources come and go as files are added and removed. Asserting on a
  // particular one made every upload a test failure, so these assert the
  // relationship between the folder and the index instead.
  it('lists every source file on disk, exactly once', () => {
    const files = fs.readdirSync(SOURCES).filter((f) => f.endsWith('.js')).sort();
    const entries = build();

    expect(entries).toHaveLength(files.length);
    expect(entries.map((e) => e.pkgPath).sort())
      .toEqual(files.map((f) => `sources/${f}`).sort());
  });

  it('gives every entry a unique whole-number id', () => {
    // Two sources sharing an id overwrite each other on install, and the app
    // shows one source where the folder holds two.
    const ids = build().map((e) => e.id);
    expect(ids.every((id) => Number.isInteger(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Animiru resolves a relative pkgPath; Mangayomi does not. A relative-only
  // entry makes the same repository work in one app and fail in the other.
  it('points at the code with an absolute URL, so Mangayomi can resolve it', () => {
    for (const entry of build()) {
      const file = entry.pkgPath.replace(/^sources\//, '');
      expect(entry.sourceCodeUrl).toBe(`${RAW_BASE}/${file}`);
      expect(entry.sourceCodeUrl).toMatch(/^https:\/\//);
    }
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
    expect(repo.sources.map((s) => s.codeUrl).sort())
      .toEqual(build().map((e) => e.sourceCodeUrl).sort());
  });

  it('serves the source code the entry points at', async () => {
    const [entry] = build();
    const code = fs.readFileSync(
      path.join(SOURCES, entry.pkgPath.replace(/^sources\//, '')), 'utf8'
    );
    jest.spyOn(http, 'request').mockResolvedValue({
      status: 200, statusCode: 200, headers: {}, body: code
    });

    const fetched = await repository.fetchSourceCode(entry.sourceCodeUrl, { version: entry.version });
    expect(String(fetched.code ?? fetched)).toContain('class DefaultExtension');
  });
});

/**
 * The folder's promise is that uploading a file is all it takes. A file the
 * generator skips in silence breaks that promise in the worst way: the
 * source is there, it is not in the index, and nothing says why.
 */
describe('a source uploaded without the .js suffix', () => {
  const stray = path.join(SOURCES, 'StraySource');

  afterEach(() => { if (fs.existsSync(stray)) fs.unlinkSync(stray); });

  it('fails the build instead of being ignored', () => {
    fs.writeFileSync(stray, 'const mangayomiSources = [];\n');
    expect(() => build()).toThrow(/StraySource.*must be a \.js file/s);
  });

  it('says what to rename it to', () => {
    fs.writeFileSync(stray, '');
    expect(() => build()).toThrow(/Rename it to StraySource\.js/);
  });
});

/**
 * The fields Mangayomi reads, which Animiru does not.
 *
 * The repository is published for both apps, and the two read the same file
 * differently. Animiru picks the fields it knows and ignores the rest, so a
 * missing field there is invisible. Mangayomi assigns from every key it
 * expects - and two of them fall back to an enum's first value rather than
 * to null, which is what makes an omission silently wrong instead of
 * absent.
 *
 * Enumerated from the build rather than from a list, so a source added
 * later is covered by the same checks without anyone remembering to add it.
 */
describe('the fields the other app reads', () => {
  // Exactly what Mangayomi's Source.fromJson assigns from the index.
  const READ_BY_MANGAYOMI = [
    'name', 'id', 'baseUrl', 'lang', 'typeSource', 'iconUrl',
    'dateFormat', 'dateFormatLocale', 'isNsfw', 'hasCloudflare',
    'sourceCodeUrl', 'apiUrl', 'version', 'isManga', 'itemType',
    'isFullData', 'appMinVerReq', 'additionalParams',
    'sourceCodeLanguage', 'notes'
  ];

  it('carries every one of them, on every source', () => {
    const missing = [];

    for (const entry of build()) {
      for (const field of READ_BY_MANGAYOMI) {
        if (!(field in entry)) missing.push(`${entry.name}: ${field}`);
      }
    }

    expect(missing).toEqual([]);
  });

  /*
   * The one that made the repository fail there.
   *
   * Mangayomi reads SourceCodeLanguage.values[json['sourceCodeLanguage'] ?? 0]
   * against enum { dart, javascript, mihon, lnreader }, so an absent field
   * declares our JavaScript to be Dart. Absent and zero are both wrong here,
   * and neither announces itself.
   */
  it('says every source is JavaScript, since every source is', () => {
    for (const entry of build()) {
      expect(entry.sourceCodeLanguage).toBe(1);
    }
  });

  // itemType has the same `?? 0` fallback, where 0 is manga - which would
  // file every one of these anime sources under the wrong media type.
  it('gives every source a media type rather than letting it default', () => {
    for (const entry of build()) {
      expect(Number.isInteger(entry.itemType)).toBe(true);
      expect(entry.itemType).toBe(1);
    }
  });

  // Mangayomi keeps the id only when it is already a number:
  // `id = json['id'] is int ? json['id'] : null`.
  it('gives every source an id that survives being read as an int', () => {
    for (const entry of build()) {
      expect(Number.isInteger(entry.id)).toBe(true);
    }
  });
});

/**
 * The repository is published at two addresses, one per app.
 *
 * Two files is how they drift: a source added to one and forgotten in the
 * other stays invisible until somebody installs from the stale link and
 * finds an extension missing, with nothing to say which of the two they
 * used. Both are written by the same builder, so both are checked.
 */
describe('both published indexes', () => {
  it.each(OUTPUTS.map((file) => [path.relative(path.join(__dirname, '..', '..'), file)]))(
    '%s is in step with the sources on disk',
    (relative) => {
      const file = path.join(__dirname, '..', '..', relative);
      expect(fs.readFileSync(file, 'utf8')).toBe(serialise(build()));
    }
  );

  // Byte-identical rather than merely equivalent: each app ignores what it
  // does not read, so there is nothing to tailor and no reason for the two
  // to differ by even a key order.
  it('are the same file at two addresses', () => {
    const [first, ...rest] = OUTPUTS.map((file) => fs.readFileSync(file, 'utf8'));
    for (const other of rest) expect(other).toBe(first);
  });
});

/**
 * The workflow that republishes the indexes must commit all of them.
 *
 * The bot names the files it stages, so a file the generator writes but the
 * workflow does not add is regenerated on every push and committed on none.
 * It goes stale on main and stays there - and the published link keeps
 * serving the old list, which is invisible from here: the repository looks
 * right, the generator is right, and only the URL is wrong.
 *
 * Read from the workflow rather than asserted as a list, so adding a third
 * output cannot pass this by being forgotten in the same way.
 */
describe('the workflow that publishes them', () => {
  const WORKFLOW = path.join(
    __dirname, '..', '..', '.github', 'workflows', 'extensions-index.yml'
  );
  const ROOT_DIR = path.join(__dirname, '..', '..');

  it('stages every file the generator writes', () => {
    const yaml = fs.readFileSync(WORKFLOW, 'utf8');
    const staged = yaml
      .split('\n')
      .filter((line) => line.includes('git add '))
      .join(' ');

    const forgotten = OUTPUTS
      .map((file) => path.relative(ROOT_DIR, file))
      .filter((relative) => !staged.includes(relative));

    expect(forgotten).toEqual([]);
  });
});
