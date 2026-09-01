/**
 * AniNeko's parsing, held to what it already produces.
 *
 * This source read pages with nine regexes over raw HTML while AniWave, its
 * sibling, uses the DOM. Regex HTML parsing breaks on any markup change and
 * needs its own entity decoding and tag stripping - both hand-written here,
 * both things a parser gives free.
 *
 * The site's origin is down (Cloudflare 522), so its live markup cannot be
 * fetched to check a rewrite against. What can be checked is that the new
 * parsing returns exactly what the old parsing returned, on markup shaped
 * the way the old regexes describe - the fixture beside this file is built
 * from those patterns, and these expectations were recorded by running the
 * regex version against it before any of it was rewritten.
 *
 * That is an equivalence proof, not a proof against the live site. If the
 * markup differs from what the regexes assumed, both versions were already
 * wrong together.
 */

const fs = require('fs');
const path = require('path');
const { runExtension } = require('../extensions');
const http = require('../extensions/http');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', '..', 'extensions', 'sources', 'anineko.js'), 'utf8'
);
const LIST_PAGE = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'pages', 'anineko-list.html'), 'utf8'
);

const ENTRY = { name: 'AniNeko', baseUrl: 'https://anineko.to', id: 1, version: '1.0.0' };

function serve(body) {
  jest.spyOn(http, 'request').mockImplementation(async ({ url }) => ({
    statusCode: 200, headers: {}, url, body
  }));
}

const run = (method, args) => runExtension({
  code: SOURCE, method, args, source: ENTRY, preferences: {}
});

afterEach(() => jest.restoreAllMocks());

describe('reading a list page', () => {
  it('finds every distinct card', async () => {
    serve(LIST_PAGE);
    const { result } = await run('getPopular', [1]);

    expect(result.list.map((item) => item.name))
      .toEqual(['One Piece', 'Naruto & Friends', 'Bleach']);
  });

  it('makes each link absolute', async () => {
    serve(LIST_PAGE);
    const { result } = await run('getPopular', [1]);

    expect(result.list[0].link).toBe('https://anineko.to/watch/one-piece');
    // The second card's href is already absolute and must not be doubled.
    expect(result.list[1].link).toBe('https://anineko.to/watch/naruto');
  });

  it('keeps the cover image', async () => {
    serve(LIST_PAGE);
    const { result } = await run('getPopular', [1]);

    expect(result.list[0].imageUrl).toBe('https://cdn.anizara.store/cover/one-piece.jpg');
  });

  // The title anchor is exact; the img alt is the fallback when a card has no
  // h3 at all.
  it('falls back to the image alt when a card has no title', async () => {
    serve(LIST_PAGE);
    const { result } = await run('getPopular', [1]);

    expect(result.list[2]).toMatchObject({ name: 'Bleach' });
  });

  // Entities have to be decoded whichever way the page writes them, or a
  // title reads "Naruto &amp; Friends" on the card.
  it('decodes entities in a title', async () => {
    serve(LIST_PAGE);
    const { result } = await run('getPopular', [1]);

    expect(result.list[1].name).toBe('Naruto & Friends');
  });

  it('folds away a card the grid repeats', async () => {
    serve(LIST_PAGE);
    const { result } = await run('getPopular', [1]);

    expect(result.list.filter((item) => item.name === 'One Piece')).toHaveLength(1);
  });

  it('sees that another page exists', async () => {
    serve(LIST_PAGE);
    const { result } = await run('getPopular', [1]);

    expect(result.hasNextPage).toBe(true);
  });

  it('sees that the last page is the last', async () => {
    serve(LIST_PAGE.replace(/<li class="page-item next">[\s\S]*?<\/li>/, ''));
    const { result } = await run('getPopular', [2]);

    expect(result.hasNextPage).toBe(false);
  });

  it('returns nothing rather than throwing on a page with no cards', async () => {
    serve('<html><body><p>Nothing here</p></body></html>');
    const { result } = await run('getPopular', [1]);

    expect(result.list).toEqual([]);
    expect(result.hasNextPage).toBe(false);
  });
});

const DETAIL_PAGE = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'pages', 'anineko-detail.html'), 'utf8'
);

describe('reading a detail page', () => {
  const detail = async (page) => {
    serve(page || DETAIL_PAGE);
    const { result } = await run('getDetail', ['/watch/aot']);
    return result;
  };

  it('takes the title from the heading', async () => {
    expect((await detail()).name).toBe('Attack on Titan');
  });

  // og:image is the site's generic preview on some pages, so a real cover
  // from the CDN wins when the page carries one.
  it('prefers a real cover over the site preview', async () => {
    expect((await detail()).imageUrl).toBe('https://cdn.anizara.store/cover/aot.jpg');
  });

  it('reads the synopsis, decoded', async () => {
    expect((await detail()).description)
      .toContain('Humanity lives behind walls & fears the Titans.');
  });

  it('falls back to the meta description when there is no synopsis', async () => {
    const stripped = DETAIL_PAGE.replace(/<div class="nv-info-synopsis">[\s\S]*?<\/div>/, '');
    expect((await detail(stripped)).description).toBe('Fallback synopsis from the meta tag.');
  });

  it('collects the genres', async () => {
    expect((await detail()).genre).toEqual(['Action', 'Drama', 'Fantasy']);
  });

  it('reads the airing status from the sidebar', async () => {
    // 0 is Mangayomi's "ongoing".
    expect((await detail()).status).toBe(0);
  });

  it('lists the episodes, newest first', async () => {
    const chapters = (await detail()).chapters;

    expect(chapters).toHaveLength(3);
    expect(chapters[0].url).toBe('https://anineko.to/watch/aot/ep-3');
    expect(chapters[2].url).toBe('https://anineko.to/watch/aot/ep-1');
  });

  // The title span repeats the number ("1 To You..."), which would read
  // "Episode 1: 1 To You..." if it were not dropped.
  it('does not repeat the episode number in its label', async () => {
    const chapters = (await detail()).chapters;
    expect(chapters[2].name).toBe('Episode 1: To You, 2000 Years in the Future');
  });

  it('keeps an episode that has no title span', async () => {
    const chapters = (await detail()).chapters;
    expect(chapters[0].name).toBe('Episode 3');
  });
});

const EPISODE_PAGE = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'pages', 'anineko-episode.html'), 'utf8'
);

/**
 * The server buttons on an episode page.
 *
 * getVideoList resolves the embeds it finds, which needs the network, so
 * these check the reading of the page rather than the resolving: the tab
 * map gives each server its language, and only the supported host is kept.
 */
describe('reading the servers on an episode page', () => {
  it('keeps only the supported host, and asks it for the stream', async () => {
    const asked = [];
    jest.spyOn(http, 'request').mockImplementation(async ({ url }) => {
      asked.push(url);
      return {
        statusCode: 200,
        headers: {},
        url,
        body: url.includes('/watch/') ? EPISODE_PAGE : ''
      };
    });

    await run('getVideoList', ['/watch/aot/ep-1']);

    // Two bibiemb servers are supported; other.host is not asked about.
    const embeds = asked.filter((url) => url.includes('bibiemb.xyz'));
    expect(embeds.length).toBeGreaterThan(0);
    expect(asked.some((url) => url.includes('other.host'))).toBe(false);
  });

  it('does not throw when the page carries no servers', async () => {
    jest.spyOn(http, 'request').mockImplementation(async ({ url }) => ({
      statusCode: 200, headers: {}, url, body: '<html><body></body></html>'
    }));

    const { result } = await run('getVideoList', ['/watch/aot/ep-1']);
    expect(result).toEqual([]);
  });
});
