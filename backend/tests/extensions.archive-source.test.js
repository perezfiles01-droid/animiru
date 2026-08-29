/**
 * The bundled Internet Archive source, run through the real sandbox.
 *
 * Only the network is stubbed. The source is loaded, instantiated and called
 * exactly as the app calls it, so this covers the bridge API it uses, the
 * shapes it returns, and the parsing in between.
 *
 * What it cannot cover is whether archive.org still answers in the shape
 * these fixtures describe. That is a real gap, and the reason the fixtures
 * are written to match the documented API rather than invented.
 */

const fs = require('fs');
const path = require('path');
const { runExtension, extractMetadata } = require('../extensions');
const http = require('../extensions/http');

const CODE = fs.readFileSync(
  path.join(__dirname, '..', '..', 'extensions', 'sources', 'archive-org.js'),
  'utf8'
);

const SOURCE = { baseUrl: 'https://archive.org' };

/** advancedsearch.php, as documented: response.docs plus paging counts. */
const SEARCH_RESPONSE = {
  response: {
    numFound: 50,
    start: 0,
    docs: [
      { identifier: 'gulliver-travels-1939', title: "Gulliver's Travels", year: '1939' },
      { identifier: 'some-anime-item', title: 'Some Anime' }
    ]
  }
};

/** metadata/<id>: an item holding two episodes, each in two encodes. */
const METADATA_RESPONSE = {
  metadata: {
    title: 'Example Series',
    description: '<p>A <b>series</b>   of things.</p>',
    subject: ['anime', 'animation']
  },
  files: [
    { name: 'ep01.mp4', format: 'h.264', size: '900000000' },
    { name: 'ep01.ogv', format: 'Ogg Video', size: '200000000' },
    { name: 'ep02.mp4', format: 'h.264', size: '880000000' },
    { name: 'cover.jpg', format: 'JPEG', size: '50000' },
    { name: 'notes.txt', format: 'Text', size: '900' }
  ]
};

function stub(bodyFor) {
  return jest.spyOn(http, 'request').mockImplementation(async ({ url }) => ({
    statusCode: 200,
    body: JSON.stringify(bodyFor(url)),
    headers: {},
    url
  }));
}

async function call(method, args) {
  const { result } = await runExtension({ code: CODE, method, args, source: SOURCE });
  return result;
}

describe('Internet Archive source', () => {
  afterEach(() => jest.restoreAllMocks());

  it('declares itself correctly', () => {
    const [declared] = extractMetadata(CODE);
    expect(declared).toMatchObject({
      name: 'Internet Archive',
      lang: 'en',
      itemType: 1,
      isMetadataCapable: true,
      baseUrl: 'https://archive.org'
    });
  });

  describe('browsing and searching', () => {
    it('returns a catalogue from the front page', async () => {
      stub(() => SEARCH_RESPONSE);
      const result = await call('getPopular', [1]);

      expect(result.list[0]).toEqual({
        name: "Gulliver's Travels",
        imageUrl: 'https://archive.org/services/img/gulliver-travels-1939',
        link: 'gulliver-travels-1939'
      });
      expect(result.hasNextPage).toBe(true);
    });

    it('restricts results to things that can be played', async () => {
      const spy = stub(() => SEARCH_RESPONSE);
      await call('getPopular', [1]);

      const requested = decodeURIComponent(spy.mock.calls[0][0].url);
      expect(requested).toContain('mediatype:(movies)');
    });

    it('searches by title', async () => {
      const spy = stub(() => SEARCH_RESPONSE);
      await call('search', ['gulliver', 1, []]);

      expect(decodeURIComponent(spy.mock.calls[0][0].url)).toContain('title:(gulliver)');
    });

    it('escapes a query that would otherwise break the URL', async () => {
      const spy = stub(() => SEARCH_RESPONSE);
      await call('search', ['ghost & shell', 1, []]);

      // Raw & would split the query string and silently drop the rest.
      expect(spy.mock.calls[0][0].url).toContain('%26');
    });

    it('reports the end of the results', async () => {
      stub(() => ({ response: { numFound: 2, start: 0, docs: SEARCH_RESPONSE.response.docs } }));
      expect((await call('getPopular', [1])).hasNextPage).toBe(false);
    });

    it('survives a query that matches nothing', async () => {
      stub(() => ({ response: { numFound: 0, start: 0, docs: [] } }));
      expect(await call('search', ['zzzz', 1, []])).toEqual({ list: [], hasNextPage: false });
    });
  });

  describe('one title', () => {
    it('lists each episode once, not once per encode', async () => {
      stub(() => METADATA_RESPONSE);
      const detail = await call('getDetail', ['example-series']);

      // ep01 exists as both mp4 and ogv; it is one episode.
      expect(detail.episodes.map((e) => e.name)).toEqual(['ep02', 'ep01']);
    });

    it('ignores files that are not video', async () => {
      stub(() => METADATA_RESPONSE);
      const detail = await call('getDetail', ['example-series']);

      const names = detail.episodes.map((e) => e.name);
      expect(names).not.toContain('cover');
      expect(names).not.toContain('notes');
    });

    it('strips the HTML the Archive puts in descriptions', async () => {
      stub(() => METADATA_RESPONSE);
      const detail = await call('getDetail', ['example-series']);

      expect(detail.description).toBe('A series of things.');
    });

    it('reads genres whether the field is a list or a string', async () => {
      stub(() => METADATA_RESPONSE);
      expect((await call('getDetail', ['x'])).genre).toEqual(['anime', 'animation']);

      jest.restoreAllMocks();
      stub(() => ({ ...METADATA_RESPONSE, metadata: { title: 'X', subject: 'anime, film' } }));
      expect((await call('getDetail', ['x'])).genre).toEqual(['anime', 'film']);
    });

    it('handles an item with no playable file', async () => {
      stub(() => ({ metadata: { title: 'Book' }, files: [{ name: 'a.pdf', format: 'PDF' }] }));
      expect((await call('getDetail', ['book'])).episodes).toEqual([]);
    });
  });

  describe('playing an episode', () => {
    it('returns every encode, largest first', async () => {
      stub(() => METADATA_RESPONSE);
      const videos = await call('getVideoList', ['example-series|ep01']);

      expect(videos).toHaveLength(2);
      expect(videos[0].quality).toBe('h.264');
      expect(videos[0].url).toBe('https://archive.org/download/example-series/ep01.mp4');
      expect(videos[1].quality).toBe('Ogg Video');
    });

    it('prefers a resolution in the filename when there is one', async () => {
      stub(() => ({
        metadata: { title: 'X' },
        files: [{ name: 'ep01.720p.mp4', format: 'h.264', size: '1' }]
      }));

      const videos = await call('getVideoList', ['x|ep01.720p']);
      expect(videos[0].quality).toBe('720p');
    });

    it('returns nothing for an episode with no matching file', async () => {
      stub(() => METADATA_RESPONSE);
      expect(await call('getVideoList', ['example-series|missing'])).toEqual([]);
    });

    it('handles an identifier containing the separator', async () => {
      // Splitting on the last | rather than the first is what makes this work.
      stub(() => METADATA_RESPONSE);
      const spy = http.request;
      await call('getVideoList', ['odd|name|ep01']);

      expect(decodeURIComponent(spy.mock.calls[0][0].url)).toContain('/metadata/odd|name');
    });
  });

  describe('when the Archive misbehaves', () => {
    it('explains a non-JSON body rather than leaking a parse error', async () => {
      jest.spyOn(http, 'request').mockResolvedValue({
        statusCode: 200,
        body: '<html>Rate limited</html>',
        headers: {},
        url: 'https://archive.org'
      });

      await expect(call('getPopular', [1])).rejects.toThrow(/did not return JSON/);
    });

    it('reports a failing status', async () => {
      jest.spyOn(http, 'request').mockResolvedValue({
        statusCode: 503, body: '', headers: {}, url: 'https://archive.org'
      });

      await expect(call('getPopular', [1])).rejects.toThrow(/responded 503/);
    });
  });
});
