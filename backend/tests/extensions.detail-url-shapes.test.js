/**
 * Taking a detail URL from whichever home produced it.
 *
 * A source that names mirrors can be browsing any one of them, and the item
 * ids it hands back are that home's own URLs. AniKoto's extractSlug matched
 * only "/watch/<slug>", which is how its first home writes them; anichi.to,
 * one of its declared mirrors, writes "/anime/<slug>". Browsing worked -
 * the listing parsed - and then opening any title failed with "Could not
 * parse slug from: https://anichi.to/anime/one-piece-odmau", because the
 * URL its own listing had just produced was one its own extractor refused.
 *
 * That is the shape of this whole class: a mirror is close enough to browse
 * and different enough to break a step later, and the difference is only
 * ever found by opening something. hianime.js already anticipated it, by
 * trying "/details/" and then falling back to the watch-page shape. This is
 * AniKoto catching up, and the check below covering the rest.
 *
 * IMPORTANT: this reads extensions/sources, the files the app actually
 * serves - NOT backend/tests/fixtures/sources, which are copies and were
 * found to be stale (anikoto's was v0.4.15 against a real v0.4.16, and
 * carried none of the mirrors this file is about). A check reading those
 * would have passed while knowing nothing about the code in question.
 */

const fs = require('fs');
const path = require('path');

const { runExtension, extractMetadata } = require('../extensions');
const http = require('../extensions/http');

const SOURCES = path.join(__dirname, '..', '..', 'extensions', 'sources');

const load = (name) => fs.readFileSync(path.join(SOURCES, `${name}.js`), 'utf8');
const entryFor = (name) => extractMetadata(load(name))[0];

const sourceNames = fs.readdirSync(SOURCES)
  .filter((name) => name.endsWith('.js'))
  .map((name) => name.replace(/\.js$/, ''));

/** Sources that declare somewhere else to go, read at runtime. */
const withMirrors = sourceNames
  .map((name) => ({ name, entry: entryFor(name) }))
  .filter((source) => Array.isArray(source.entry.mirrors) && source.entry.mirrors.length > 0);

function stubHttp(body = '<html><body></body></html>') {
  const calls = [];
  jest.spyOn(http, 'request').mockImplementation(async (options) => {
    calls.push(options);
    return {
      status: 200,
      statusCode: 200,
      headers: { 'content-type': 'text/html' },
      body: typeof body === 'function' ? body(options) : body
    };
  });
  return { calls };
}

/**
 * True when a failure is the source refusing to read its own URL, rather
 * than the empty page this stub hands it.
 *
 * The distinction is the whole test. A source given a blank document will
 * fail for all sorts of ordinary reasons - no title, no episodes, a missing
 * selector - and none of those mean the URL was rejected. Only a message
 * about parsing the URL itself does.
 */
const isUrlRejection = (message) => /could not parse|invalid url|no slug|unrecognised url|bad url/i
  .test(String(message || ''));

afterEach(() => jest.restoreAllMocks());

describe('AniKoto, on a mirror that writes detail URLs differently', () => {
  const source = entryFor('anikoto');

  const openDetail = async (url) => {
    stubHttp();
    return runExtension({
      code: load('anikoto'), method: 'getDetail', args: [url], source
    }).catch((err) => err);
  };

  // The exact URL from the report.
  it('reads a slug from the /anime/ shape a mirror produced', async () => {
    const outcome = await openDetail('https://anichi.to/anime/one-piece-odmau');

    expect(isUrlRejection(outcome && outcome.message)).toBe(false);
  });

  it('still reads the /watch/ shape its first home produces', async () => {
    const outcome = await openDetail('https://anikototv.to/watch/one-piece-odmau');

    expect(isUrlRejection(outcome && outcome.message)).toBe(false);
  });

  // A watch URL carrying an episode is still a URL about the series, and
  // the series is what getDetail is being asked for.
  it('reads the slug from a watch URL that names an episode', async () => {
    const outcome = await openDetail('https://anichi.to/watch/one-piece-odmau/ep-1');

    expect(isUrlRejection(outcome && outcome.message)).toBe(false);
  });

  it('takes the same slug whichever shape carried it', async () => {
    const asked = [];

    for (const url of [
      'https://anichi.to/anime/one-piece-odmau',
      'https://anichi.to/watch/one-piece-odmau',
      'https://anichi.to/watch/one-piece-odmau/ep-1'
    ]) {
      const { calls } = stubHttp();
      await runExtension({
        code: load('anikoto'), method: 'getDetail', args: [url], source
      }).catch(() => {});
      asked.push(calls.length ? String(calls[0].url) : '');
      jest.restoreAllMocks();
    }

    expect(asked.every((url) => url.includes('one-piece-odmau'))).toBe(true);
  });

  /*
   * The near miss. A URL naming no title must still fail loudly: an
   * extractor relaxed until it matches anything returns a slug of "" or of
   * whatever fragment it found, and the request that follows is a quiet
   * 404 rather than a message saying what went wrong.
   */
  it('still refuses a URL that names no title at all', async () => {
    const outcome = await openDetail('https://anichi.to/');

    expect(isUrlRejection(outcome && outcome.message)).toBe(true);
  });
});

/**
 * The rest of the family, enumerated from the directory and from each
 * source's own mirror list, so a mirror added later is covered without
 * anyone remembering to come back here.
 */
describe('every source that declares mirrors', () => {
  it('finds the sources by reading the directory, not a list written here', () => {
    expect(withMirrors.length).toBeGreaterThan(0);
    expect(sourceNames.length).toBeGreaterThan(withMirrors.length);
  });

  describe.each(withMirrors)('$name', ({ name, entry }) => {
    /*
     * Host-independence, and only that.
     *
     * Sources spell their detail URLs differently - AniKoto uses /watch/,
     * HiAnime /details/ - so asserting one shape against all of them flags
     * correct code, which is how a check gets switched off within a week.
     * An earlier version of this test did exactly that and reported
     * hianimez.org as broken when it was not.
     *
     * What is common to all of them is that the HOST must not matter: the
     * same path is the same request wherever rotation is pointing. So each
     * mirror is compared against the source's own baseUrl carrying the
     * identical path. Rejecting both is a shape the source does not use.
     * Accepting its own and rejecting a mirror is the fault.
     */
    const rejects = async (url) => {
      stubHttp();
      const outcome = await runExtension({
        code: load(name), method: 'getDetail', args: [url], source: entry
      }).catch((err) => err);
      jest.restoreAllMocks();
      return isUrlRejection(outcome && outcome.message);
    };

    it.each(entry.mirrors)('treats %s exactly as it treats its own home', async (mirror) => {
      const PATH = '/watch/some-title-abc123';

      expect(await rejects(mirror + PATH)).toBe(await rejects(entry.baseUrl + PATH));
    });
  });
});
