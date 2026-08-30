/**
 * KickAssAnime, run through the real sandbox with the network stubbed.
 *
 * The version this replaces scraped <a> tags out of the homepage and always
 * returned nothing: KAA is a single-page app whose HTML ships an empty
 * shell and fetches its catalogue as JSON afterwards. These cover the API
 * reading, and the tolerance for KAA having moved fields between releases.
 *
 * kaa.lt is unreachable from this environment, so the shapes are written to
 * the API its own front end uses rather than captured from a live response.
 */

const fs = require('fs');
const path = require('path');
const { runExtension, extractMetadata } = require('../extensions');
const http = require('../extensions/http');

const CODE = fs.readFileSync(
  path.join(__dirname, '..', '..', 'extensions', 'sources', 'kaa.js'), 'utf8'
);

const SOURCE = { baseUrl: 'https://kaa.lt', apiUrl: 'https://kaa.lt/api' };

const SHOWS = {
  result: [
    { slug: 'one-piece-99cf', title: 'One Piece', poster: { hq: 'one-piece' } },
    { slug: 'naruto-1a2b', title: 'Naruto', poster: { hq: 'naruto' } }
  ],
  pages: 3
};

const DETAIL = {
  slug: 'one-piece-99cf',
  title: 'One Piece',
  poster: { hq: 'one-piece' },
  synopsis: 'A <b>pirate</b> story.',
  genres: ['Action', 'Adventure'],
  status: 'currently_airing'
};

const EPISODES = {
  result: [
    { slug: 'ep-1-abc', episode_number: 1, title: "I'm Luffy!" },
    { slug: 'ep-2-def', episode_number: 2, title: 'Enter the Great Swordsman' }
  ],
  pages: [1]
};

const SERVERS = {
  servers: [
    { name: 'VidStreaming', shortName: 'vid', src: 'https://cdn.kaa.lt/a.m3u8' },
    { name: 'Mp4upload', shortName: 'mp4', src: 'https://cdn.kaa.lt/b.mp4' }
  ]
};

const seen = [];

function stub(routes) {
  return jest.spyOn(http, 'request').mockImplementation(async (options) => {
    seen.push(options);
    const { url } = options;

    for (const [fragment, payload] of Object.entries(routes)) {
      if (url.includes(fragment)) {
        return typeof payload === 'object' && payload.statusCode
          ? payload
          : { statusCode: 200, headers: {}, url, body: JSON.stringify(payload) };
      }
    }
    throw new Error(`unstubbed request: ${url}`);
  });
}

const call = async (method, args) =>
  (await runExtension({ code: CODE, method, args, source: SOURCE })).result;

describe('KickAssAnime', () => {
  beforeEach(() => { seen.length = 0; });
  afterEach(() => jest.restoreAllMocks());

  it('declares itself correctly', () => {
    expect(extractMetadata(CODE)[0]).toMatchObject({
      name: 'KickAssAnime', id: 174839261, itemType: 1
    });
  });

  // The whole reason the previous version returned nothing.
  it('reads the API rather than the page', async () => {
    stub({ '/api/show/popular': SHOWS });
    await call('getPopular', [1]);

    expect(seen[0].url).toContain('/api/show/popular');
    expect(seen.every((request) => request.url.includes('/api/'))).toBe(true);
  });

  it('lists the titles it is given', async () => {
    stub({ '/api/show/popular': SHOWS });
    const { list, hasNextPage } = await call('getPopular', [1]);

    expect(list.map((item) => item.name)).toEqual(['One Piece', 'Naruto']);
    expect(list[0].link).toBe('one-piece-99cf');
    expect(hasNextPage).toBe(true);
  });

  it('builds a poster URL from the name KAA returns', async () => {
    stub({ '/api/show/popular': SHOWS });
    const { list } = await call('getPopular', [1]);

    expect(list[0].imageUrl).toBe('https://kaa.lt/image/poster/one-piece.webp');
  });

  // KAA has moved these between releases; a source pinned to one spelling
  // breaks on the next change with no clue why.
  it('copes with a list returned bare, and a poster returned as a string', async () => {
    stub({ '/api/show/popular': [{ slug: 'x', title: 'Bare', poster: 'bare-poster' }] });
    const { list } = await call('getPopular', [1]);

    expect(list[0]).toMatchObject({
      name: 'Bare', imageUrl: 'https://kaa.lt/image/poster/bare-poster.webp'
    });
  });

  it('stops offering pages at the last one', async () => {
    stub({ '/api/show/popular': { ...SHOWS, pages: 1 } });
    expect((await call('getPopular', [1])).hasNextPage).toBe(false);
  });

  it('reads the recent list for latest updates', async () => {
    stub({ '/api/show/recent': SHOWS });
    await call('getLatestUpdates', [1]);
    expect(seen[0].url).toContain('/show/recent');
  });

  describe('searching', () => {
    // A GET returns the site's shell, not results.
    it('posts the query as JSON', async () => {
      stub({ '/api/search': SHOWS });
      await call('search', ['one piece', 1, {}]);

      expect(seen[0].method).toBe('POST');
      expect(JSON.parse(seen[0].body)).toEqual({ query: 'one piece' });
    });

    it('asks nothing for an empty query', async () => {
      stub({});
      expect(await call('search', ['   ', 1, {}])).toEqual({ list: [], hasNextPage: false });
      expect(seen).toHaveLength(0);
    });
  });

  describe('details', () => {
    const routes = {
      '/episodes': EPISODES,
      '/api/show/one-piece-99cf': DETAIL
    };

    it('names the title, which a detail with no name shows as Untitled', async () => {
      stub(routes);
      expect((await call('getDetail', ['one-piece-99cf'])).name).toBe('One Piece');
    });

    it('reads the synopsis, genres and status', async () => {
      stub(routes);
      const detail = await call('getDetail', ['one-piece-99cf']);

      expect(detail).toMatchObject({
        description: 'A pirate story.',
        genre: ['Action', 'Adventure'],
        status: 0
      });
    });

    it('lists the episodes newest first, addressed by both slugs', async () => {
      stub(routes);
      const { episodes } = await call('getDetail', ['one-piece-99cf']);

      expect(episodes.map((episode) => episode.episodeNumber)).toEqual([2, 1]);
      expect(episodes[1].url).toBe('one-piece-99cf/ep-1-abc');
      expect(episodes[1].name).toContain("I'm Luffy!");
    });
  });

  describe('playback', () => {
    it('returns every server the episode offers', async () => {
      stub({ '/episode/': SERVERS });
      const videos = await call('getVideoList', ['one-piece-99cf/ep-1-abc']);

      expect(videos.map((video) => video.url)).toEqual([
        'https://cdn.kaa.lt/a.m3u8', 'https://cdn.kaa.lt/b.mp4'
      ]);
      expect(videos[0].headers).toEqual({ Referer: 'https://kaa.lt/' });
    });

    // Returning an empty list makes the app look broken rather than the
    // episode; KAA guards these endpoints and changes them often.
    it('says so when no server is listed, rather than returning nothing', async () => {
      stub({ '/episode/': { servers: [] } });

      await expect(call('getVideoList', ['one-piece-99cf/ep-1-abc']))
        .rejects.toThrow(/listed no server/);
    });
  });

  // Exactly what the old version did: it asked for the page and found no
  // titles in the shell that came back.
  it('names the shell when it gets HTML where JSON belongs', async () => {
    stub({ '/api/show/popular': { statusCode: 200, headers: {}, url: 'x', body: '<html></html>' } });

    await expect(call('getPopular', [1]))
      .rejects.toThrow(/page rather than JSON.*catalogue lives in the API/s);
  });
});
