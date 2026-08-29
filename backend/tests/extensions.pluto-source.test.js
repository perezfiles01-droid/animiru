/**
 * The Pluto TV source, run through the real sandbox.
 *
 * Only the network is stubbed. What this covers is the session handshake,
 * the shapes returned, and the region-lock case - which is the failure a
 * user is most likely to hit, and the one that looks like a bug when it is
 * not.
 *
 * What it cannot cover is whether Pluto still answers in these shapes. That
 * needs one run against the live service from a server in a country it
 * serves.
 */

const fs = require('fs');
const path = require('path');
const { runExtension, extractMetadata } = require('../extensions');
const http = require('../extensions/http');

const CODE = fs.readFileSync(
  path.join(__dirname, '..', '..', 'extensions', 'sources', 'plutotv.js'),
  'utf8'
);

const SOURCE = { baseUrl: 'https://pluto.tv', apiUrl: 'https://service-vod.clusters.pluto.tv' };

const BOOT = {
  sessionToken: 'jwt-token-here',
  servers: { stitcher: 'https://stitcher-ipv4.pluto.tv' },
  stitcherParams: 'deviceType=web&sid=abc123'
};

const CATEGORIES = {
  categories: [
    {
      name: 'Reality',
      items: [{ _id: 'r1', name: 'Some Reality Show', slug: 'some-reality-show', covers: [] }]
    },
    {
      name: 'Anime',
      items: [{
        _id: 'a1',
        name: 'An Anime',
        slug: 'an-anime',
        covers: [
          { aspectRatio: '16:9', url: 'https://img/wide.jpg' },
          { aspectRatio: '600:900', url: 'https://img/poster.jpg' }
        ]
      }]
    }
  ]
};

const SERIES = {
  _id: 'a1',
  name: 'An Anime',
  slug: 'an-anime',
  summary: 'A show about things.',
  genre: 'Anime',
  covers: [{ aspectRatio: '600:900', url: 'https://img/poster.jpg' }],
  seasons: [{
    number: 1,
    episodes: [
      { _id: 'e1', name: 'Beginnings', number: 1, stitched: { path: '/v2/stitch/hls/episode/e1/master.m3u8?x=1' } },
      { _id: 'e2', name: 'Middles', number: 2, stitched: { path: '/v2/stitch/hls/episode/e2/master.m3u8' } }
    ]
  }]
};

/** Routes each stubbed request by URL, the way the real endpoints differ. */
function stub(routes) {
  return jest.spyOn(http, 'request').mockImplementation(async ({ url }) => {
    for (const [fragment, body] of routes) {
      if (url.includes(fragment)) {
        if (typeof body === 'number') {
          return { statusCode: body, body: '', headers: {}, url };
        }
        return { statusCode: 200, body: JSON.stringify(body), headers: {}, url };
      }
    }
    throw new Error(`Unstubbed request: ${url}`);
  });
}

async function call(method, args) {
  const { result } = await runExtension({ code: CODE, method, args, source: SOURCE });
  return result;
}

describe('Pluto TV source', () => {
  afterEach(() => jest.restoreAllMocks());

  it('declares itself as an anime source', () => {
    expect(extractMetadata(CODE)[0]).toMatchObject({
      name: 'Pluto TV', itemType: 1, isMetadataCapable: true
    });
  });

  describe('browsing', () => {
    it('flattens the categories into one catalogue', async () => {
      stub([['vod/categories', CATEGORIES]]);
      const result = await call('getPopular', [1]);

      expect(result.list).toHaveLength(2);
      expect(result.list.map((i) => i.link)).toContain('an-anime');
    });

    it('puts anime categories first, since that is what this app is for', async () => {
      stub([['vod/categories', CATEGORIES]]);
      const result = await call('getPopular', [1]);

      expect(result.list[0].name).toBe('An Anime');
    });

    it('picks the poster crop rather than the first image', async () => {
      stub([['vod/categories', CATEGORIES]]);
      const result = await call('getPopular', [1]);

      const anime = result.list.find((i) => i.link === 'an-anime');
      expect(anime.imageUrl).toBe('https://img/poster.jpg');
    });

    it('does not list the same title twice across categories', async () => {
      stub([['vod/categories', {
        categories: [
          { name: 'Anime', items: [{ _id: 'a1', name: 'A', slug: 'a', covers: [] }] },
          { name: 'Popular', items: [{ _id: 'a1', name: 'A', slug: 'a', covers: [] }] }
        ]
      }]]);

      expect((await call('getPopular', [1])).list).toHaveLength(1);
    });
  });

  describe('when Pluto is not available where the server runs', () => {
    it('explains an empty catalogue as the region lock it is', async () => {
      stub([['vod/categories', { categories: [] }]]);

      await expect(call('getPopular', [1])).rejects.toThrow(/region-locked/);
    });

    it('explains a 403 the same way', async () => {
      stub([['vod/categories', 403]]);

      await expect(call('getPopular', [1])).rejects.toThrow(/region-locked/);
    });
  });

  describe('one title', () => {
    it('lists episodes with season and number', async () => {
      stub([['vod/slugs/', SERIES]]);
      const detail = await call('getDetail', ['an-anime']);

      expect(detail.name).toBe('An Anime');
      expect(detail.description).toBe('A show about things.');
      expect(detail.episodes.map((e) => e.name)).toEqual([
        'S1E1 - Beginnings', 'S1E2 - Middles'
      ]);
    });

    it('carries the stitched path on the episode, so playback needs no second lookup', async () => {
      stub([['vod/slugs/', SERIES]]);
      const detail = await call('getDetail', ['an-anime']);

      expect(detail.episodes[0].url).toBe('e1|/v2/stitch/hls/episode/e1/master.m3u8?x=1');
    });

    it('treats a film as a single episode', async () => {
      stub([['vod/slugs/', {
        _id: 'm1', name: 'A Film', slug: 'a-film', covers: [],
        stitched: { path: '/v2/stitch/hls/episode/m1/master.m3u8' }
      }]]);

      const detail = await call('getDetail', ['a-film']);
      expect(detail.episodes).toEqual([
        { name: 'A Film', url: 'm1|/v2/stitch/hls/episode/m1/master.m3u8' }
      ]);
    });
  });

  describe('playback', () => {
    it('boots a session and appends its parameters to the stream', async () => {
      stub([['boot.pluto.tv', BOOT]]);
      const videos = await call('getVideoList', ['e1|/v2/stitch/hls/episode/e1/master.m3u8?x=1']);

      expect(videos).toHaveLength(1);
      expect(videos[0].url).toBe(
        'https://stitcher-ipv4.pluto.tv/v2/stitch/hls/episode/e1/master.m3u8'
        + '?x=1&deviceType=web&sid=abc123&jwt=jwt-token-here'
      );
    });

    it('starts the query string when the stitched path has none', async () => {
      stub([['boot.pluto.tv', BOOT]]);
      const videos = await call('getVideoList', ['e2|/v2/stitch/hls/episode/e2/master.m3u8']);

      expect(videos[0].url).toContain('master.m3u8?deviceType=web');
    });

    it('builds a path from the episode id when none was carried', async () => {
      stub([['boot.pluto.tv', BOOT]]);
      const videos = await call('getVideoList', ['e3|']);

      expect(videos[0].url).toContain('/v2/stitch/hls/episode/e3/master.m3u8');
    });

    it('does not claim quality tiers Pluto does not offer', async () => {
      stub([['boot.pluto.tv', BOOT]]);
      const videos = await call('getVideoList', ['e1|/p.m3u8']);

      // One adaptive playlist: the player picks the rendition, not us.
      expect(videos[0].quality).toBe('Auto (HLS)');
    });

    it('sends a fresh client id on every boot', async () => {
      const spy = stub([['boot.pluto.tv', BOOT]]);
      await call('getVideoList', ['e1|/p.m3u8']);
      const first = spy.mock.calls[0][0].url;

      jest.restoreAllMocks();
      const spy2 = stub([['boot.pluto.tv', BOOT]]);
      await call('getVideoList', ['e1|/p.m3u8']);

      expect(spy2.mock.calls[0][0].url).not.toBe(first);
    });
  });

  describe('search', () => {
    it('maps results from the search service', async () => {
      stub([['media-search', { data: [{ _id: 's1', name: 'Found', slug: 'found', covers: [] }] }]]);
      const result = await call('search', ['found', 1, []]);

      expect(result.list).toEqual([
        { name: 'Found', imageUrl: undefined, link: 'found' }
      ]);
    });

    it('accepts the other keys the search service has used', async () => {
      stub([['media-search', { items: [{ _id: 's1', name: 'Found', slug: 'found', covers: [] }] }]]);
      expect((await call('search', ['found', 1, []])).list).toHaveLength(1);
    });

    it('survives a search that matches nothing', async () => {
      stub([['media-search', { data: [] }]]);
      expect(await call('search', ['zzz', 1, []])).toEqual({ list: [], hasNextPage: false });
    });
  });
});
