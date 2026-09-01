/**
 * AnimeHeaven's parsing, held to what it already produces.
 *
 * The last bundled source reading HTML structure with regexes rather than
 * the DOM - the same shape AniNeko was in before it was converted. Regex
 * HTML parsing breaks on any markup change and needs its own entity
 * decoding, which is hand-written here as _decodeHtml.
 *
 * The site cannot be reached from here to check a rewrite against its live
 * markup, so the fixture beside this file is built from what the existing
 * regexes describe, and these expectations were recorded by running the
 * regex version against it before anything was rewritten. The DOM version
 * has to return the same results.
 *
 * That is an equivalence proof, not a proof against the live site: if the
 * markup differs from what the regexes assumed, both versions were already
 * wrong together.
 */

const fs = require('fs');
const path = require('path');
const { runExtension } = require('../extensions');
const http = require('../extensions/http');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', '..', 'extensions', 'sources', 'animeheaven.js'), 'utf8'
);
const LIST_PAGE = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'pages', 'animeheaven-list.html'), 'utf8'
);

const ENTRY = {
  name: 'AnimeHeaven', baseUrl: 'https://animeheaven.me', id: 2, version: '1.0.0'
};

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
  it('finds every distinct title', async () => {
    serve(LIST_PAGE);
    const { result } = await run('getPopular', [1]);

    expect(result.list.map((item) => item.name))
      .toEqual(['One Piece', 'Naruto & Friends', 'Bleach']);
  });

  it('builds absolute links', async () => {
    serve(LIST_PAGE);
    const { result } = await run('getPopular', [1]);

    expect(result.list[0].link).toBe('https://animeheaven.me/anime.php?ABC123');
  });

  // The cover comes from a different anchor to the title, matched by the
  // href they share.
  it('pairs each title with the cover from its own image anchor', async () => {
    serve(LIST_PAGE);
    const { result } = await run('getPopular', [1]);

    expect(result.list[0].imageUrl).toBe('https://animeheaven.me/image.php?ABC123');
    // Already absolute, and must not be prefixed again.
    expect(result.list[1].imageUrl).toBe('https://cdn.animeheaven.me/naruto.jpg');
  });

  it('keeps a title that has no image anchor', async () => {
    serve(LIST_PAGE);
    const { result } = await run('getPopular', [1]);

    expect(result.list[2]).toMatchObject({ name: 'Bleach', imageUrl: '' });
  });

  it('decodes entities in a title', async () => {
    serve(LIST_PAGE);
    const { result } = await run('getPopular', [1]);

    expect(result.list[1].name).toBe('Naruto & Friends');
  });

  it('folds away a title the page repeats', async () => {
    serve(LIST_PAGE);
    const { result } = await run('getPopular', [1]);

    expect(result.list.filter((item) => item.name === 'One Piece')).toHaveLength(1);
  });

  // The image anchor wraps a tag rather than text, so it is not a title.
  it('does not mistake a wrapping anchor for a title', async () => {
    serve(LIST_PAGE);
    const { result } = await run('getPopular', [1]);

    expect(result.list.map((item) => item.name)).not.toContain('Wrapped');
  });

  it('returns nothing rather than throwing on a page with no results', async () => {
    serve('<html><body><p>No results</p></body></html>');
    const { result } = await run('getPopular', [1]);

    expect(result.list).toEqual([]);
  });
});

const DETAIL_PAGE = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'pages', 'animeheaven-detail.html'), 'utf8'
);

describe('reading a detail page', () => {
  const detail = async (page) => {
    serve(page || DETAIL_PAGE);
    const { result } = await run('getDetail', ['https://animeheaven.me/anime.php?AOT']);
    return result;
  };

  it('takes the title from the info block', async () => {
    expect((await detail()).name).toBe('Attack on Titan');
  });

  it('makes the poster absolute', async () => {
    expect((await detail()).imageUrl).toBe('https://animeheaven.me/image.php?AOT');
  });

  // og:image is the site's generic preview, used only when there is no
  // poster on the page.
  it('falls back to og:image when there is no poster', async () => {
    const stripped = DETAIL_PAGE.replace(/<img class='posterimg[^>]*>/, '');
    expect((await detail(stripped)).imageUrl).toBe('https://animeheaven.me/preview.png');
  });

  it('reads the description, decoded', async () => {
    expect((await detail()).description)
      .toBe('Humanity lives behind walls & fears the Titans.');
  });

  it('collects the genres', async () => {
    expect((await detail()).genre).toEqual(['Action', 'Drama']);
  });

  it('reads the airing status', async () => {
    // 0 is Mangayomi's "ongoing".
    expect((await detail()).status).toBe(0);
  });

  // Each episode anchor carries its gate key in an onclick, and its number
  // in a watch2 element. The key is the chapter url.
  it('lists the episodes with their gate keys', async () => {
    const chapters = (await detail()).chapters;

    expect(chapters).toHaveLength(3);
    expect(chapters[0]).toEqual({ name: 'Episode 3', url: 'aaa111' });
    expect(chapters[2]).toEqual({ name: 'Episode 1', url: 'ccc333' });
  });

  it('numbers an episode by position when the page gives no number', async () => {
    const noNumbers = DETAIL_PAGE.replace(/<div class='watch2 bc'>\d+<\/div>/g, '<div>x</div>');
    const chapters = (await detail(noNumbers)).chapters;

    expect(chapters.map((c) => c.name)).toEqual(['Episode 1', 'Episode 2', 'Episode 3']);
  });
});
