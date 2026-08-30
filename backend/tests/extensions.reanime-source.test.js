/**
 * The bundled Re:ANIME source, run through the real sandbox.
 *
 * Only the network is stubbed. What these cover is the source's tolerance
 * of layout: the same title grid is fed to it in three different shapes,
 * because the site renames its classes far more often than it changes its
 * structure, and a source that only parses one shape breaks silently.
 *
 * What they cannot cover is reanime.to's actual markup - this session
 * cannot reach the site. The fixtures are representative of the templates
 * these sites use, not captured from it.
 */

const fs = require('fs');
const path = require('path');
const { runExtension, extractMetadata } = require('../extensions');
const http = require('../extensions/http');

const CODE = fs.readFileSync(
  path.join(__dirname, '..', '..', 'extensions', 'sources', 'reanime.js'),
  'utf8'
);

const SOURCE = { baseUrl: 'https://reanime.to', apiUrl: 'https://reanime.to' };

const page = (body) => `<html><head></head><body>${body}</body></html>`;

/** The shape with a known container class. */
const GRID_KNOWN = page(`
  <div class="film_list-wrap">
    <div class="flw-item">
      <a href="/anime/frieren" title="Frieren"><img data-src="/img/frieren.jpg" alt="Frieren"></a>
      <h3 class="film-name">Frieren</h3>
    </div>
    <div class="flw-item">
      <a href="/anime/dandadan"><img src="/img/dandadan.jpg" alt="Dandadan"></a>
      <h3 class="film-name">Dandadan</h3>
    </div>
  </div>
  <ul class="pagination"><li class="page-item"><a class="page-link" href="?page=2">2</a></li></ul>
`);

/** The same grid after a redesign: no container this source knows. */
const GRID_UNKNOWN = page(`
  <section class="brand-new-classname-2027">
    <a href="/anime/frieren"><img data-original="/img/frieren.jpg" alt="Frieren"></a>
    <a href="/anime/dandadan"><img data-original="/img/dandadan.jpg" alt="Dandadan"></a>
  </section>
`);

const DETAIL = page(`
  <meta property="og:title" content="Sousou no Frieren - Re:ANIME">
  <meta property="og:image" content="https://reanime.to/img/poster.jpg">
  <h1>Sousou no Frieren</h1>
  <div class="anime-synopsis"><p>A mage <b>outlives</b>   her party.</p></div>
  <div class="info"><span>Status: Currently Airing</span></div>
  <a href="/genre/adventure">Adventure</a>
  <a href="/genre/drama">Drama</a>
  <a href="/genre/drama">Drama</a>
  <div class="episodes">
    <a href="/watch/frieren-episode-1" title="Episode 1">Ep. 1</a>
    <a href="/watch/frieren-episode-2" title="Episode 2">Ep. 2</a>
    <a href="/watch/frieren-episode-3" title="Episode 3">Ep. 3</a>
  </div>
`);

const WATCH_IFRAME = page(`
  <div id="servers">
    <div data-src="https://embed.example.com/e/abc">Server A</div>
    <div data-embed="//embed2.example.com/e/def">Server B</div>
  </div>
  <div id="player"><iframe src="https://embed.example.com/e/abc"></iframe></div>
`);

const WATCH_DIRECT = page(`
  <div id="player"><iframe src="https://embed.example.com/e/abc"></iframe></div>
  <script>var config = {"file":"https://cdn.reanime.to/hls/frieren/1/index.m3u8"};</script>
`);

const seen = [];

function stub(routes) {
  return jest.spyOn(http, 'request').mockImplementation(async (options) => {
    seen.push(options);
    const { url } = options;

    for (const [fragment, body] of Object.entries(routes)) {
      if (url.includes(fragment)) {
        return typeof body === 'object'
          ? body
          : { statusCode: 200, body, headers: {}, url };
      }
    }

    throw new Error(`unstubbed request: ${url}`);
  });
}

async function call(method, args) {
  const { result } = await runExtension({ code: CODE, method, args, source: SOURCE });
  return result;
}

describe('Re:ANIME source', () => {
  beforeEach(() => { seen.length = 0; });
  afterEach(() => jest.restoreAllMocks());

  it('declares itself as an anime source with a unique id', () => {
    // itemType 2 is a novel. Anime is 1, and 1002 belongs to AnimePahe.
    expect(extractMetadata(CODE)[0]).toMatchObject({
      name: 'Re:ANIME', id: 1003, itemType: 1, hasCloudflare: true
    });
  });

  describe('reading a grid of titles', () => {
    it('reads the layout it knows', async () => {
      stub({ '/popular': GRID_KNOWN });
      const { list, hasNextPage } = await call('getPopular', [1]);

      expect(list).toEqual([
        { name: 'Frieren', imageUrl: 'https://reanime.to/img/frieren.jpg', link: '/anime/frieren' },
        { name: 'Dandadan', imageUrl: 'https://reanime.to/img/dandadan.jpg', link: '/anime/dandadan' }
      ]);
      expect(hasNextPage).toBe(true);
    });

    // The point of the design: a redesign renames classes, and the source
    // should still find the titles rather than returning an empty page.
    it('still reads it when every class name has changed', async () => {
      stub({ '/popular': GRID_UNKNOWN });
      const { list } = await call('getPopular', [1]);

      expect(list.map((i) => i.name)).toEqual(['Frieren', 'Dandadan']);
      expect(list[0].link).toBe('/anime/frieren');
    });

    it('prefers the lazy-loaded poster over the placeholder in src', async () => {
      stub({ '/popular': page(
        '<a href="/anime/x"><img src="/placeholder.gif" data-src="/real.jpg" alt="X"></a>'
      ) });

      expect((await call('getPopular', [1])).list[0].imageUrl)
        .toBe('https://reanime.to/real.jpg');
    });

    it('lists a title once even when the page links it twice', async () => {
      stub({ '/popular': page(
        '<a href="/anime/x"><img alt="X"></a><a href="/anime/x">X again</a>'
      ) });

      expect((await call('getPopular', [1])).list).toHaveLength(1);
    });

    it('stops offering a next page when the page offers none', async () => {
      stub({ '/popular': GRID_UNKNOWN });
      expect((await call('getPopular', [1])).hasNextPage).toBe(false);
    });

    // An empty catalogue from a healthy-looking source is the failure most
    // easily mistaken for a bug in the app.
    it('says the layout has changed rather than returning nothing', async () => {
      stub({ '/popular': page('<div>nothing here</div>') });

      await expect(call('getPopular', [1]))
        .rejects.toThrow(/no titles on it.*selectors in this source/s);
    });
  });

  describe('searching', () => {
    it('asks the search endpoint and reads the results', async () => {
      stub({ '/search': GRID_KNOWN });
      const { list } = await call('search', ['frieren', 1, {}]);

      expect(seen[0].url).toContain('keyword=frieren');
      expect(list).toHaveLength(2);
    });

    // Unlike an empty catalogue, no results is a real answer.
    it('returns nothing without complaining when nothing matches', async () => {
      stub({ '/search': page('<div class="no-results">No results</div>') });

      const { list } = await call('search', ['zzzz', 1, {}]);
      expect(list).toEqual([]);
    });
  });

  describe('details', () => {
    it('reads the title, poster, synopsis and genres', async () => {
      stub({ '/anime/frieren': DETAIL });
      const detail = await call('getDetail', ['/anime/frieren']);

      expect(detail).toMatchObject({
        name: 'Sousou no Frieren',
        imageUrl: 'https://reanime.to/img/poster.jpg',
        description: 'A mage outlives her party.',
        genre: ['Adventure', 'Drama'],
        status: 0,
        link: '/anime/frieren'
      });
    });

    it('lists the episodes newest first, numbered', async () => {
      stub({ '/anime/frieren': DETAIL });
      const { episodes } = await call('getDetail', ['/anime/frieren']);

      expect(episodes.map((e) => e.episodeNumber)).toEqual([3, 2, 1]);
      expect(episodes[2]).toMatchObject({
        name: 'Episode 1', url: '/watch/frieren-episode-1'
      });
    });

    it('takes the episode number from the URL when the label has none', async () => {
      stub({ '/anime/x': page('<a href="/watch/show-episode-7">Watch now</a>') });

      const { episodes } = await call('getDetail', ['/anime/x']);
      expect(episodes[0]).toMatchObject({ name: 'Episode 7', episodeNumber: 7 });
    });

    it('accepts a full URL as well as a path', async () => {
      stub({ '/anime/frieren': DETAIL });
      const detail = await call('getDetail', ['https://reanime.to/anime/frieren']);
      expect(detail.link).toBe('/anime/frieren');
    });
  });

  describe('playback', () => {
    it('lists every server the page offers', async () => {
      stub({ '/watch/': WATCH_IFRAME });
      const videos = await call('getVideoList', ['/watch/frieren-episode-1']);

      expect(videos.map((v) => v.url)).toEqual([
        'https://embed.example.com/e/abc',
        'https://embed2.example.com/e/def'
      ]);
    });

    it('names each server by its host when the page does not label it', async () => {
      stub({ '/watch/': WATCH_IFRAME });
      const videos = await call('getVideoList', ['/watch/frieren-episode-1']);
      expect(videos[1].quality).toBe('Server B');
    });

    // A playlist in the page plays without resolving an embed first, so it
    // is the better default.
    it('finds a direct playlist and offers it first', async () => {
      stub({ '/watch/': WATCH_DIRECT });
      const videos = await call('getVideoList', ['/watch/frieren-episode-1']);

      expect(videos[0]).toMatchObject({
        url: 'https://cdn.reanime.to/hls/frieren/1/index.m3u8', quality: 'Direct'
      });
    });

    it('does not offer the same server twice', async () => {
      // The iframe repeats the server already listed in the picker.
      stub({ '/watch/': WATCH_IFRAME });
      const videos = await call('getVideoList', ['/watch/frieren-episode-1']);
      expect(new Set(videos.map((v) => v.url)).size).toBe(videos.length);
    });

    it('carries a Referer, without which most embed hosts refuse', async () => {
      stub({ '/watch/': WATCH_IFRAME });
      const videos = await call('getVideoList', ['/watch/frieren-episode-1']);
      expect(videos[0].headers).toEqual({ Referer: 'https://reanime.to/' });
    });

    it('says so when the episode has no player', async () => {
      stub({ '/watch/': page('<div>Coming soon</div>') });

      await expect(call('getVideoList', ['/watch/frieren-episode-1']))
        .rejects.toThrow(/listed no player/);
    });
  });

  describe('sending a request the site will answer', () => {
    // The previous version passed { headers: {...} } as the second
    // argument, which is the headers themselves - so it sent a header
    // literally named "headers" and none of the ones it meant to.
    it('sends the headers as headers, not nested under one called "headers"', async () => {
      stub({ '/popular': GRID_KNOWN });
      await call('getPopular', [1]);

      expect(seen[0].headers).toMatchObject({
        'User-Agent': expect.stringContaining('Mozilla/5.0'),
        Referer: 'https://reanime.to/'
      });
      expect(seen[0].headers.headers).toBeUndefined();
    });

    it('names the Cloudflare challenge rather than failing on the parse', async () => {
      stub({ '/popular': { statusCode: 403, body: '', headers: {}, url: 'x' } });

      await expect(call('getPopular', [1])).rejects.toThrow(/Cloudflare challenge/);
    });

    it('recognises the challenge even when it arrives as a 200', async () => {
      stub({ '/popular': page('<h1>Just a moment...</h1>') });

      await expect(call('getPopular', [1])).rejects.toThrow(/browser check/);
    });
  });

  describe('when Re:ANIME moves domain', () => {
    it('uses the address set in the source settings', async () => {
      stub({ '/popular': GRID_KNOWN });

      const { result } = await runExtension({
        code: CODE, method: 'getPopular', args: [1], source: SOURCE,
        preferences: { reanime_base_url: 'https://reanime.se/' }
      });

      expect(seen[0].url).toBe('https://reanime.se/popular?page=1');
      // Links stay site-relative, so a domain change does not strand them.
      expect(result.list[0].link).toBe('/anime/frieren');
    });
  });
});
