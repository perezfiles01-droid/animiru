/**
 * The shared helpers a source can use to clean up what it scraped.
 *
 * These were checked by a bare assert script that lived beside the module
 * and ran top to bottom: the first failing assertion aborted the file, so
 * nothing after it was checked at all, and the failure reported a line
 * number rather than what was being asserted. It had been failing for some
 * time on an expectation the module had outgrown.
 *
 * Written as tests, each case names what it protects, and one failure does
 * not hide the rest.
 */

const {
  sourceString,
  sourceIsUrl,
  sourceAbsoluteUrl,
  sourceUniqueItems,
  sourceValidateAnimeItem,
  sourceValidateAnimeList,
  sourceValidateEpisode,
  sourceValidateEpisodes,
  sourceValidateDetail,
  sourceValidateVideo,
  sourceValidateVideos,
  sourceEmptyDiagnostics,
  sourcePage
} = require('../extensions/source-helper');

const BASE = 'https://example.com';

describe('reading a scraped value', () => {
  it('trims what the page had around it', () => {
    expect(sourceString('  Hello  ')).toBe('Hello');
  });

  it('falls back when the value was never there', () => {
    expect(sourceString(null, 'fallback')).toBe('fallback');
    expect(sourceString(undefined)).toBe('');
  });
});

describe('what counts as a URL', () => {
  it.each([
    ['https://example.com/test', true],
    ['http://example.com', true],
    ['not-a-url', false],
    ['', false]
  ])('%s -> %s', (value, expected) => {
    expect(sourceIsUrl(value)).toBe(expected);
  });

  // A link is followed by the app. A scheme that is not http is not a page
  // to fetch, and some of them are worse than useless.
  it.each([['javascript:alert(1)'], ['data:text/html,x'], ['file:///etc/passwd']])(
    'refuses %s',
    (value) => expect(sourceIsUrl(value)).toBe(false)
  );
});

describe('making a scraped link absolute', () => {
  it.each([
    ['/anime/one-piece', 'https://example.com/anime/one-piece'],
    ['anime/one-piece', 'https://example.com/anime/one-piece'],
    ['//cdn.test/x', 'https://cdn.test/x'],
    ['https://other.test/x', 'https://other.test/x']
  ])('resolves %s', (link, expected) => {
    expect(sourceAbsoluteUrl(BASE, link)).toBe(expected);
  });
});

describe('validating one anime card', () => {
  it('keeps a card that has what the app needs', () => {
    const checked = sourceValidateAnimeItem(
      { name: 'One Piece', link: '/anime/one-piece', imageUrl: '/images/one-piece.jpg' },
      BASE
    );

    expect(checked.valid).toBe(true);
    expect(checked.item.name).toBe('One Piece');
    expect(checked.item.link).toBe('https://example.com/anime/one-piece');
    expect(checked.item.imageUrl).toBe('https://example.com/images/one-piece.jpg');
  });

  it('drops a card with no name, which would show as Untitled', () => {
    expect(sourceValidateAnimeItem({ link: '/anime/test' }, BASE).valid).toBe(false);
  });

  /*
   * This is the case the old script got wrong, and the reason it had been
   * failing: it expected a bare "not-a-url" to be rejected.
   *
   * It is a relative path, and sources emit them constantly - a slug with
   * no leading slash is one of the commonest shapes a listing page yields.
   * Resolving it against the base is the whole job of this helper, and
   * rejecting it would throw away real results from real sources. What has
   * to be rejected is a link that cannot be fetched at all, which is the
   * case below.
   */
  it('accepts a bare slug, because that is a relative path', () => {
    const checked = sourceValidateAnimeItem({ name: 'Test', link: 'not-a-url' }, BASE);

    expect(checked.valid).toBe(true);
    expect(checked.item.link).toBe('https://example.com/not-a-url');
  });

  it.each([[''], ['   '], ['javascript:alert(1)'], ['data:text/html,x']])(
    'drops a card whose link is %s',
    (link) => expect(sourceValidateAnimeItem({ name: 'Test', link }, BASE).valid).toBe(false)
  );

  it('drops something that is not an object at all', () => {
    expect(sourceValidateAnimeItem(null, BASE).valid).toBe(false);
    expect(sourceValidateAnimeItem('One Piece', BASE).valid).toBe(false);
  });
});

describe('validating a list of cards', () => {
  it('resolves the ones it keeps and counts the ones it drops', () => {
    const checked = sourceValidateAnimeList(
      [
        { name: 'One Piece', link: '/anime/one-piece' },
        { name: 'Naruto', link: '/anime/naruto' },
        { name: 'One Piece', link: '/anime/one-piece' }
      ],
      BASE
    );

    // The duplicate is folded away; the two distinct titles remain.
    expect(checked.list).toHaveLength(2);
    expect(checked.list[0].name).toBe('One Piece');
  });

  it('says so when the source returned something that is not a list', () => {
    const checked = sourceValidateAnimeList(null, BASE);

    expect(checked.valid).toBe(false);
    expect(checked.list).toEqual([]);
    expect(checked.errors[0]).toMatch(/did not return an array/);
  });

  it('names which item failed, so the author can find it', () => {
    const checked = sourceValidateAnimeList([{ link: '/x' }], BASE);
    expect(checked.errors[0]).toMatch(/^Item 0:/);
  });
});

describe('validating episodes', () => {
  it('keeps an episode and resolves its URL', () => {
    const checked = sourceValidateEpisode(
      { name: 'Episode 1', url: '/watch/test/1', isFiller: false },
      BASE
    );

    expect(checked.valid).toBe(true);
    expect(checked.item.url).toBe('https://example.com/watch/test/1');
    expect(checked.item.isFiller).toBe(false);
  });

  // Sources spell it both ways.
  it('takes the URL from link when there is no url', () => {
    const checked = sourceValidateEpisode({ name: 'E1', link: '/watch/1' }, BASE);
    expect(checked.item.url).toBe('https://example.com/watch/1');
  });

  it('drops an episode with no name', () => {
    expect(sourceValidateEpisode({ url: '/watch/1' }, BASE).valid).toBe(false);
  });

  it('folds away a repeated episode', () => {
    const checked = sourceValidateEpisodes(
      [
        { name: 'Episode 1', url: '/watch/test/1' },
        { name: 'Episode 2', url: '/watch/test/2' },
        { name: 'Episode 2', url: '/watch/test/2' }
      ],
      BASE
    );

    expect(checked.chapters).toHaveLength(2);
  });
});

describe('validating a detail page', () => {
  it('accepts one that carries everything the screen renders', () => {
    const checked = sourceValidateDetail({
      name: 'One Piece',
      link: 'https://example.com/anime/one-piece',
      genre: ['Action', 'Adventure'],
      chapters: [{ name: 'Episode 1', url: 'https://example.com/watch/1' }]
    }, BASE);

    expect(checked.valid).toBe(true);
  });

  it('names a missing title, which is what shows as Untitled', () => {
    const checked = sourceValidateDetail({ name: '', genre: [], chapters: [] }, BASE);

    expect(checked.valid).toBe(false);
    expect(checked.errors).toContain('Detail has no name');
  });
});

describe('validating videos', () => {
  it('keeps a video that has a URL', () => {
    expect(sourceValidateVideo({
      url: 'https://cdn.example.com/video.m3u8', quality: '1080p'
    }).valid).toBe(true);
  });

  // Sources spell it both ways here too.
  it('accepts file where there is no url', () => {
    expect(sourceValidateVideo({ file: 'https://cdn.example.com/v.m3u8' }).valid).toBe(true);
  });

  it('drops a video with no URL, which would play nothing', () => {
    expect(sourceValidateVideo({ quality: '1080p' }).valid).toBe(false);
  });

  it('keeps every usable video in a list', () => {
    const checked = sourceValidateVideos([
      { url: 'https://cdn.example.com/720.m3u8', quality: '720p' },
      { url: 'https://cdn.example.com/1080.m3u8', quality: '1080p' }
    ]);

    expect(checked.list).toHaveLength(2);
  });
});

describe('explaining an empty result', () => {
  it('says what was asked and how many requests it took', () => {
    const report = sourceEmptyDiagnostics('search', 'Kimi wo Aisuru', [
      { url: 'https://example.com/search', statusCode: 200 }
    ]);

    expect(report.type).toBe('EMPTY_RESULT');
    expect(report.method).toBe('search');
    expect(report.query).toBe('Kimi wo Aisuru');
    expect(report.requestCount).toBe(1);
    expect(Array.isArray(report.suggestions)).toBe(true);
  });
});

describe('a page of results', () => {
  it('carries the list and whether there is more', () => {
    const page = sourcePage([{ name: 'One Piece', link: 'https://example.com/one-piece' }], true);

    expect(page.list).toHaveLength(1);
    expect(page.hasNextPage).toBe(true);
  });

  // A source that returns nothing must not read as "there is more".
  it('is empty rather than broken when the source returned nothing', () => {
    expect(sourcePage(null)).toEqual({ list: [], hasNextPage: false });
  });
});

describe('folding away duplicates', () => {
  it('matches regardless of case', () => {
    expect(sourceUniqueItems([{ link: '/A' }, { link: '/a' }])).toHaveLength(1);
  });

  it('skips entries with nothing to identify them', () => {
    expect(sourceUniqueItems([{}, null, { link: '/a' }])).toHaveLength(1);
  });
});
