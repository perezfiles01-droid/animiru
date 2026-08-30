/**
 * The bundled AnimePahe source, run through the real sandbox.
 *
 * Only the network is stubbed. The source is loaded, instantiated and called
 * exactly as the app calls it, so this covers the bridge API it uses, the
 * HTML and JSON parsing, the kwik extraction, and the shapes it returns.
 *
 * What it cannot cover is whether AnimePahe still answers in the shape these
 * fixtures describe - this session cannot reach the site. The fixtures are
 * written to match the endpoints the site documents through its own front
 * end rather than invented, but the first real proof is a device.
 */

const fs = require('fs');
const path = require('path');
const { runExtension, extractMetadata } = require('../extensions');
const http = require('../extensions/http');

const CODE = fs.readFileSync(
  path.join(__dirname, '..', '..', 'extensions', 'sources', 'animepahe.js'),
  'utf8'
);

const SOURCE = { baseUrl: 'https://animepahe.ru', apiUrl: 'https://animepahe.ru/api' };

/** api?m=airing: episodes, so one title repeats once per release. */
const AIRING = {
  total: 100,
  current_page: 1,
  last_page: 4,
  data: [
    {
      id: 1, anime_id: 10, anime_title: 'Frieren', anime_session: 'frieren-session',
      episode: 12, snapshot: 'https://i.animepahe.ru/frieren.jpg', session: 'ep12'
    },
    {
      id: 2, anime_id: 10, anime_title: 'Frieren', anime_session: 'frieren-session',
      episode: 11, snapshot: 'https://i.animepahe.ru/frieren.jpg', session: 'ep11'
    },
    {
      id: 3, anime_id: 20, anime_title: 'Dandadan', anime_session: 'dandadan-session',
      episode: 4, snapshot: 'https://i.animepahe.ru/dandadan.jpg', session: 'ep4'
    }
  ]
};

/** api?m=search: at most eight titles, no paging. */
const SEARCH = {
  total: 2,
  data: [
    { id: 10, title: 'Frieren', session: 'frieren-session', poster: 'https://i/f.jpg', year: 2023 },
    { id: 30, title: 'Frieren Special', session: 'special-session', poster: 'https://i/s.jpg' }
  ]
};

const ANIME_PAGE = `
  <html><body>
    <div class="title-wrapper"><h1><span>Sousou no Frieren</span></h1></div>
    <div class="anime-poster"><a><img data-src="https://i.animepahe.ru/poster.jpg"></a></div>
    <div class="anime-summary">
      <p class="anime-status"><strong>Status:</strong> <a href="#">Finished Airing</a></p>
    </div>
    <div class="anime-synopsis"><p>A mage <b>outlives</b>   her party.</p></div>
    <div class="anime-genre"><ul>
      <li><a href="#">Adventure</a></li><li><a href="#">Drama</a></li>
    </ul></div>
  </body></html>
`;

/** api?m=release: two pages, so the paging loop is actually exercised. */
const RELEASES = {
  1: {
    current_page: 1, last_page: 2,
    data: [
      { id: 101, episode: 1, session: 'ep1-session', created_at: '2023-09-29 15:00:00' },
      { id: 102, episode: 2, session: 'ep2-session', created_at: '2023-10-06 15:00:00' }
    ]
  },
  2: {
    current_page: 2, last_page: 2,
    data: [{ id: 103, episode: 3, session: 'ep3-session', created_at: '2023-10-13 15:00:00' }]
  }
};

const PLAY_PAGE = `
  <html><body><div id="resolutionMenu">
    <button data-src="https://kwik.si/e/aaa" data-audio="jpn" data-resolution="360">SubsPlease · 360p</button>
    <button data-src="https://kwik.si/e/bbb" data-audio="jpn" data-resolution="1080">SubsPlease · 1080p</button>
    <button data-src="https://kwik.si/e/ccc" data-audio="eng" data-resolution="1080">Dub · 1080p</button>
  </div></body></html>
`;

/**
 * A real packed payload in the packer's own format, not a stand-in: the
 * point of this fixture is that unpackJs actually unpacks it.
 */
function kwikPage(streamUrl) {
  return `<html><script>eval(function(p,a,c,k,e,d){` +
    `while(c--)if(k[c])p=p.replace(new RegExp('\\\\b'+c.toString(a)+'\\\\b','g'),k[c]);return p}` +
    `('const 1=\\'0\\';',36,2,'${streamUrl}|source'.split('|'),0,{}))</script></html>`;
}

const STREAM = {
  'https://kwik.si/e/aaa': 'https://eu-1.kwik.si/stream/360/uwu.m3u8',
  'https://kwik.si/e/bbb': 'https://eu-1.kwik.si/stream/1080/uwu.m3u8',
  'https://kwik.si/e/ccc': 'https://eu-1.kwik.si/stream/dub/uwu.m3u8'
};

const seen = [];

function stub(overrides = {}) {
  return jest.spyOn(http, 'request').mockImplementation(async (options) => {
    const { url } = options;
    seen.push(options);

    const reply = (body) => ({ statusCode: 200, body, headers: {}, url });

    if (overrides[url] !== undefined) return overrides[url];
    if (url in STREAM) return reply(kwikPage(STREAM[url]));
    if (url.includes('m=airing')) return reply(JSON.stringify(AIRING));
    if (url.includes('m=search')) return reply(JSON.stringify(SEARCH));
    if (url.includes('m=release')) {
      const page = Number(/[?&]page=(\d+)/.exec(url)?.[1] || 1);
      return reply(JSON.stringify(RELEASES[page]));
    }
    if (url.includes('/anime/')) return reply(ANIME_PAGE);
    if (url.includes('/play/')) return reply(PLAY_PAGE);

    throw new Error(`unstubbed request: ${url}`);
  });
}

async function call(method, args) {
  const { result } = await runExtension({ code: CODE, method, args, source: SOURCE });
  return result;
}

describe('AnimePahe source', () => {
  beforeEach(() => { seen.length = 0; stub(); });
  afterEach(() => jest.restoreAllMocks());

  it('declares itself correctly', () => {
    expect(extractMetadata(CODE)[0]).toMatchObject({
      name: 'AnimePahe', id: 1002, itemType: 1, hasCloudflare: true
    });
  });

  describe('browsing', () => {
    it('collapses the airing feed to one entry per title', async () => {
      // The feed lists episodes. Frieren released twice, and showing it
      // twice on one page is what the previous version did.
      const { list, hasNextPage } = await call('getPopular', [1]);

      expect(list.map((i) => i.name)).toEqual(['Frieren', 'Dandadan']);
      expect(list[0]).toMatchObject({
        link: 'frieren-session', imageUrl: 'https://i.animepahe.ru/frieren.jpg'
      });
      expect(hasNextPage).toBe(true);
    });

    it('asks for the airing endpoint, paged the way the site pages', async () => {
      await call('getPopular', [3]);
      expect(seen[0].url).toContain('m=airing');
      expect(seen[0].url).toContain('page=3');
    });

    it('stops offering a next page at the last one', async () => {
      jest.restoreAllMocks();
      stub({}); // fresh
      jest.spyOn(http, 'request').mockResolvedValue({
        statusCode: 200, headers: {}, url: 'x',
        body: JSON.stringify({ ...AIRING, current_page: 4, last_page: 4 })
      });
      expect((await call('getPopular', [4])).hasNextPage).toBe(false);
    });
  });

  describe('searching', () => {
    it('returns the titles, keyed by session', async () => {
      const { list } = await call('search', ['frieren', 1, {}]);
      expect(list).toEqual([
        { name: 'Frieren', imageUrl: 'https://i/f.jpg', link: 'frieren-session' },
        { name: 'Frieren Special', imageUrl: 'https://i/s.jpg', link: 'special-session' }
      ]);
    });

    // Search is an unpaged top-eight. Offering a next page loads the same
    // results again, which reads as the app repeating itself.
    it('never claims a second page', async () => {
      expect((await call('search', ['frieren', 1, {}])).hasNextPage).toBe(false);
    });
  });

  describe('details', () => {
    it('reads the title, poster, synopsis and genres from the page', async () => {
      const detail = await call('getDetail', ['frieren-session']);

      expect(detail).toMatchObject({
        name: 'Sousou no Frieren',
        imageUrl: 'https://i.animepahe.ru/poster.jpg',
        description: 'A mage outlives her party.',
        genre: ['Adventure', 'Drama'],
        link: 'frieren-session'
      });
    });

    // 1 is completed. The previous version returned 2, which is hiatus.
    it('maps a finished show to completed, not hiatus', async () => {
      expect((await call('getDetail', ['frieren-session'])).status).toBe(1);
    });

    it('follows the release pages to the end', async () => {
      const { episodes } = await call('getDetail', ['frieren-session']);

      expect(episodes.map((e) => e.episodeNumber)).toEqual([3, 2, 1]);
      expect(episodes[2]).toMatchObject({
        name: 'Episode 1', url: 'frieren-session/ep1-session', episodeNumber: 1
      });
    });

    it('addresses an episode by both sessions, which is what playback needs', async () => {
      const { episodes } = await call('getDetail', ['frieren-session']);
      for (const episode of episodes) {
        expect(episode.url).toMatch(/^frieren-session\/ep\d-session$/);
      }
    });
  });

  describe('playback', () => {
    it('resolves every kwik server to a stream URL', async () => {
      const videos = await call('getVideoList', ['frieren-session/ep1-session']);

      expect(videos).toHaveLength(3);
      expect(videos.map((v) => v.url)).toEqual(
        expect.arrayContaining(Object.values(STREAM))
      );
    });

    it('unpacks the packed player script rather than evaluating it', async () => {
      // eval is disabled in the sandbox deliberately. If this passes, the
      // extraction is going through unpackJs.
      const [best] = await call('getVideoList', ['frieren-session/ep1-session']);
      expect(best.url).toMatch(/^https:\/\/eu-1\.kwik\.si\/stream\/.*\.m3u8$/);
    });

    it('offers the highest resolution first', async () => {
      const videos = await call('getVideoList', ['frieren-session/ep1-session']);
      expect(videos[0].quality).toContain('1080p');
      expect(videos[videos.length - 1].quality).toContain('360p');
    });

    it('labels sub and dub apart, which is the choice being made', async () => {
      const videos = await call('getVideoList', ['frieren-session/ep1-session']);
      const labels = videos.map((v) => v.quality);

      expect(labels.some((l) => l.includes('DUB'))).toBe(true);
      expect(labels.filter((l) => l.includes('SUB'))).toHaveLength(2);
    });

    // kwik rejects a request that does not come from its own page, so the
    // player has to send this or every stream 403s.
    it('carries the Referer kwik requires', async () => {
      const videos = await call('getVideoList', ['frieren-session/ep1-session']);
      expect(videos[0].headers).toEqual({ Referer: 'https://kwik.si/' });
    });

    it('still plays the servers that resolve when one fails', async () => {
      jest.restoreAllMocks();
      stub({ 'https://kwik.si/e/bbb': { statusCode: 404, body: '', headers: {}, url: 'x' } });

      const videos = await call('getVideoList', ['frieren-session/ep1-session']);
      expect(videos).toHaveLength(2);
    });

    it('says what went wrong when no server resolves', async () => {
      jest.restoreAllMocks();
      stub({
        'https://kwik.si/e/aaa': { statusCode: 404, body: '', headers: {}, url: 'x' },
        'https://kwik.si/e/bbb': { statusCode: 404, body: '', headers: {}, url: 'x' },
        'https://kwik.si/e/ccc': { statusCode: 404, body: '', headers: {}, url: 'x' }
      });

      await expect(call('getVideoList', ['frieren-session/ep1-session']))
        .rejects.toThrow(/No AnimePahe server could be resolved/);
    });

    it('says so when the episode has no servers yet', async () => {
      jest.restoreAllMocks();
      stub({});
      jest.spyOn(http, 'request').mockResolvedValue({
        statusCode: 200, headers: {}, url: 'x',
        body: '<html><body><div id="resolutionMenu"></div></body></html>'
      });

      await expect(call('getVideoList', ['frieren-session/ep1-session']))
        .rejects.toThrow(/listed no servers/);
    });
  });

  describe('getting past DDoS-Guard', () => {
    // Without all three the site answers with an interstitial, and the
    // source then fails on JSON parsing rather than on the real cause.
    it('sends a browser User-Agent, a Referer and the __ddg cookies', async () => {
      await call('getPopular', [1]);

      expect(seen[0].headers).toMatchObject({
        'User-Agent': expect.stringContaining('Mozilla/5.0'),
        Referer: 'https://animepahe.ru/',
        Cookie: '__ddg1_=;__ddg2_=;'
      });
    });

    it('names the browser check when it gets HTML where JSON belongs', async () => {
      jest.restoreAllMocks();
      jest.spyOn(http, 'request').mockResolvedValue({
        statusCode: 200, headers: {}, url: 'x', body: '<html>checking your browser</html>'
      });

      const failure = call('getPopular', [1]);
      await expect(failure).rejects.toThrow(/DDoS-Guard bot protection/);
      // Not the reader's device: the request came from the server.
      await expect(failure).rejects.toThrow(/not at your device/);
    });
  });

  describe('when AnimePahe moves domain', () => {
    it('uses the address set in the source settings', async () => {
      const { result } = await runExtension({
        code: CODE, method: 'getPopular', args: [1], source: SOURCE,
        preferences: { animepahe_base_url: 'https://animepahe.org/' }
      });

      expect(result.list).toHaveLength(2);
      // Trailing slash trimmed, or every URL would carry a double slash.
      expect(seen[0].url).toBe('https://animepahe.org/api?m=airing&page=1');
    });

    it('falls back to the declared address when the setting is untouched', async () => {
      await call('getPopular', [1]);
      expect(seen[0].url).toContain('https://animepahe.ru/api');
    });
  });
});
