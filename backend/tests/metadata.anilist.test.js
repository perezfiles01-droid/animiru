/**
 * Watch order and recommendations.
 *
 * Extensions cannot supply either - a source returns titles, episodes and
 * streams, and has no concept of a sequel or of one show being recommended
 * alongside another - so this reads AniList. Only the network is stubbed.
 */

const anilist = require('../metadata/anilist');
const http = require('../extensions/http');

/** A franchise: a TV season, its sequel, a movie, and an unrelated show. */
const MEDIA = {
  1: {
    id: 1, idMal: 11, title: { romaji: 'Mayonaka Heart Tune', english: 'Tune In to the Midnight Heart' },
    format: 'TV', episodes: 12, seasonYear: 2026, startDate: { year: 2026 },
    coverImage: { large: 'https://i.test/1.jpg' }, genres: ['Comedy', 'Romance'],
    description: 'A <b>radio</b> host.', averageScore: 74, status: 'FINISHED',
    relations: { edges: [
      { relationType: 'SEQUEL', node: { id: 2, type: 'ANIME', format: 'TV' } },
      { relationType: 'CHARACTER', node: { id: 9, type: 'ANIME', format: 'TV' } }
    ] }
  },
  2: {
    id: 2, title: { romaji: 'Mayonaka Heart Tune 2nd Season' },
    format: 'TV', seasonYear: 2027, startDate: { year: 2027 },
    coverImage: { large: 'https://i.test/2.jpg' }, genres: [],
    relations: { edges: [
      { relationType: 'PREQUEL', node: { id: 1, type: 'ANIME', format: 'TV' } },
      // Two hops from where the user started: the walk has to reach it.
      { relationType: 'SIDE_STORY', node: { id: 3, type: 'ANIME', format: 'MOVIE' } },
      // Not something you watch.
      { relationType: 'ADAPTATION', node: { id: 8, type: 'MANGA', format: 'MANGA' } }
    ] }
  },
  3: {
    id: 3, title: { romaji: 'Mayonaka Heart Tune: The Movie' },
    format: 'MOVIE', seasonYear: 2025, startDate: { year: 2025 },
    coverImage: { large: 'https://i.test/3.jpg' }, genres: [],
    relations: { edges: [] }
  },
  9: {
    id: 9, title: { romaji: 'Shares A Voice Actor' }, format: 'TV',
    seasonYear: 2020, startDate: { year: 2020 }, coverImage: {}, genres: [],
    relations: { edges: [] }
  }
};

function stub(handler) {
  return jest.spyOn(http, 'request').mockImplementation(async ({ body }) => {
    const { query, variables } = JSON.parse(body);
    return {
      statusCode: 200, headers: {}, url: 'https://graphql.anilist.co',
      body: JSON.stringify(handler(query, variables))
    };
  });
}

const mediaHandler = (query, variables) => {
  if (query.includes('Page(')) {
    return { data: { Page: { media: [MEDIA[1]] } } };
  }
  if (query.includes('recommendations')) {
    return { data: { Media: { recommendations: { edges: [
      { node: { rating: 200, mediaRecommendation: MEDIA[3] } },
      { node: { rating: 100, mediaRecommendation: MEDIA[9] } }
    ] } } } };
  }
  return { data: { Media: MEDIA[variables.id] } };
};

describe('matching a source title to AniList', () => {
  beforeEach(() => { anilist.clearCache(); stub(mediaHandler); });
  afterEach(() => jest.restoreAllMocks());

  it('finds the entry and keeps every title it is known by', async () => {
    const [match] = await anilist.search('Tune In to the Midnight Heart');

    expect(match).toMatchObject({ id: 1, title: 'Tune In to the Midnight Heart' });
    // The two databases disagree about names; both have to be visible so a
    // wrong match can be recognised.
    expect(match.titles).toEqual(
      expect.arrayContaining(['Mayonaka Heart Tune', 'Tune In to the Midnight Heart'])
    );
  });

  it('strips the markup AniList leaves in descriptions', async () => {
    const [match] = await anilist.search('anything');
    expect(match.description).toBe('A radio host.');
  });

  it('asks nothing for an empty title', async () => {
    expect(await anilist.search('   ')).toEqual([]);
    expect(http.request).not.toHaveBeenCalled();
  });
});

describe('building a watch order', () => {
  beforeEach(() => { anilist.clearCache(); stub(mediaHandler); });
  afterEach(() => jest.restoreAllMocks());

  // Stopping one hop from where the user started would give a different
  // order depending on which entry they opened, which is not an order.
  it('follows the story further than one hop', async () => {
    const entries = await anilist.getWatchOrder(1);
    expect(entries.map((e) => e.id).sort()).toEqual([1, 2, 3]);
  });

  it('numbers from the oldest, whatever was opened', async () => {
    const entries = await anilist.getWatchOrder(2);

    expect(entries.map((e) => [e.position, e.year])).toEqual([
      [1, 2025], [2, 2026], [3, 2027]
    ]);
  });

  it('includes movies and specials, not only seasons', async () => {
    const entries = await anilist.getWatchOrder(1);
    expect(entries.find((e) => e.id === 3).format).toBe('MOVIE');
  });

  // Following these turns a watch order into a tour of everything sharing
  // a voice actor.
  it('ignores relations that only share a cast', async () => {
    const entries = await anilist.getWatchOrder(1);
    expect(entries.map((e) => e.id)).not.toContain(9);
  });

  it('leaves out what is not watchable', async () => {
    const entries = await anilist.getWatchOrder(1);
    expect(entries.map((e) => e.id)).not.toContain(8);
  });

  it('puts an unaired entry last rather than first', async () => {
    jest.restoreAllMocks();
    stub((query, variables) => ({
      data: {
        Media: variables.id === 1
          ? { ...MEDIA[1], relations: { edges: [
            { relationType: 'SEQUEL', node: { id: 4, type: 'ANIME', format: 'TV' } }
          ] } }
          : {
            id: 4, title: { romaji: 'Announced, undated' }, format: 'TV',
            seasonYear: null, startDate: { year: null }, coverImage: {}, genres: [],
            relations: { edges: [] }
          }
      }
    }));

    const entries = await anilist.getWatchOrder(1);
    expect(entries[entries.length - 1].id).toBe(4);
  });

  it('keeps the rest of the order when one entry cannot be fetched', async () => {
    jest.restoreAllMocks();
    stub((query, variables) => {
      if (variables.id === 2) throw new Error('network');
      return { data: { Media: MEDIA[variables.id] } };
    });

    const entries = await anilist.getWatchOrder(1);
    expect(entries.map((e) => e.id)).toEqual([1]);
  });
});

describe('recommendations', () => {
  beforeEach(() => { anilist.clearCache(); stub(mediaHandler); });
  afterEach(() => jest.restoreAllMocks());

  it('returns them strongest first', async () => {
    const results = await anilist.getRecommendations(1);
    expect(results.map((r) => r.id)).toEqual([3, 9]);
  });

  // AniList gives a vote count. "142 people agreed" means nothing on its
  // own, so it is scaled against the strongest recommendation for the title.
  it('turns votes into the percentage the screen shows', async () => {
    const results = await anilist.getRecommendations(1);

    expect(results[0].percent).toBe(100);
    expect(results[1].percent).toBe(50);
  });

  it('carries the poster, synopsis and genres the screen shows', async () => {
    const [first] = await anilist.getRecommendations(1);

    expect(first.poster).toBe('https://i.test/3.jpg');
    expect(first).toHaveProperty('description');
    expect(first).toHaveProperty('genres');
  });

  it('does not divide by zero when nothing has been voted for', async () => {
    jest.restoreAllMocks();
    stub(() => ({ data: { Media: { recommendations: { edges: [
      { node: { rating: 0, mediaRecommendation: MEDIA[3] } }
    ] } } } }));

    expect((await anilist.getRecommendations(1))[0].percent).toBeNull();
  });
});

describe('when AniList will not answer', () => {
  beforeEach(() => anilist.clearCache());
  afterEach(() => jest.restoreAllMocks());

  it('names a rate limit as one', async () => {
    jest.spyOn(http, 'request').mockResolvedValue({
      statusCode: 429, headers: {}, url: 'x', body: ''
    });

    await expect(anilist.search('x')).rejects.toThrow(/rate limiting/);
  });

  // GraphQL reports errors with a 200, so the status alone proves nothing.
  it('notices an error returned with a 200', async () => {
    jest.spyOn(http, 'request').mockResolvedValue({
      statusCode: 200, headers: {}, url: 'x',
      body: JSON.stringify({ errors: [{ message: 'Not Found' }] })
    });

    await expect(anilist.search('x')).rejects.toThrow(/rejected the query: Not Found/);
  });

  it('says so when the body is not JSON', async () => {
    jest.spyOn(http, 'request').mockResolvedValue({
      statusCode: 200, headers: {}, url: 'x', body: '<html>gateway</html>'
    });

    await expect(anilist.search('x')).rejects.toThrow(/not JSON/);
  });
});

describe('caching', () => {
  beforeEach(() => anilist.clearCache());
  afterEach(() => jest.restoreAllMocks());

  it('asks AniList once for a repeated search', async () => {
    stub(mediaHandler);

    await anilist.search('Frieren');
    await anilist.search('Frieren');

    expect(http.request).toHaveBeenCalledTimes(1);
  });
});

/**
 * Browsing a season.
 *
 * Extensions cannot answer this - a source has no notion of a season - so
 * it is one AniList query rather than a filter implemented separately in
 * every source, most of which do not have one.
 */
describe('what aired in a season', () => {
  beforeEach(() => anilist.clearCache());
  afterEach(() => jest.restoreAllMocks());

  const seasonStub = () => stub(() => ({
    data: { Page: { pageInfo: { hasNextPage: true }, media: [MEDIA[1], MEDIA[3]] } }
  }));

  it('asks AniList for that season and year', async () => {
    seasonStub();
    await anilist.getSeason({ season: 'winter', year: 2026 });

    const { variables } = JSON.parse(http.request.mock.calls[0][0].body);
    expect(variables).toMatchObject({ season: 'WINTER', seasonYear: 2026 });
  });

  it('returns the titles with their posters and years', async () => {
    seasonStub();
    const { results } = await anilist.getSeason({ season: 'winter', year: 2026 });

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ title: expect.any(String), year: 2026 });
  });

  it('reports whether there is another page', async () => {
    seasonStub();
    expect((await anilist.getSeason({ season: 'winter', year: 2026 })).hasNextPage).toBe(true);
  });

  // "Any season" is a year on its own, which AniList accepts as a null season.
  it('allows a year with no season', async () => {
    seasonStub();
    await anilist.getSeason({ year: 2026 });

    const { variables } = JSON.parse(http.request.mock.calls[0][0].body);
    expect(variables.season).toBeNull();
    expect(variables.seasonYear).toBe(2026);
  });

  // A season without a year would return whatever aired in that season of
  // any year, which is not a thing anyone means.
  it('refuses a season with no year', async () => {
    await expect(anilist.getSeason({ season: 'winter' })).rejects.toThrow(/year is needed/);
  });

  it('asks once for a season already fetched', async () => {
    seasonStub();
    await anilist.getSeason({ season: 'winter', year: 2026 });
    await anilist.getSeason({ season: 'winter', year: 2026 });

    expect(http.request).toHaveBeenCalledTimes(1);
  });
});

/**
 * The rows a front page opens with.
 *
 * All one shape because they differ only in how AniList is asked to sort;
 * three near-identical functions would be three places to fix when the media
 * fields change.
 */
describe('the front page charts', () => {
  beforeEach(() => anilist.clearCache());
  afterEach(() => jest.restoreAllMocks());

  const chartStub = () => stub(() => ({ data: { Page: { media: [MEDIA[1], MEDIA[3]] } } }));

  const sentVariables = () => JSON.parse(http.request.mock.calls[0][0].body).variables;

  it('sorts trending by what is being watched now', async () => {
    chartStub();
    await anilist.getChart('trending');

    expect(sentVariables().sort).toEqual(['TRENDING_DESC', 'POPULARITY_DESC']);
  });

  it('asks for the season AniList is actually in', async () => {
    chartStub();
    await anilist.getChart('season', { now: new Date('2026-11-15T00:00:00Z') });

    expect(sentVariables()).toMatchObject({ season: 'FALL', seasonYear: 2026 });
  });

  // The screen names the row, so it needs to be told which season it got.
  it('says which season it answered for', async () => {
    chartStub();
    const chart = await anilist.getChart('season', { now: new Date('2026-02-01T00:00:00Z') });

    expect(chart).toMatchObject({ season: 'WINTER', year: 2026 });
  });

  it.each([
    ['2026-01-15', 'WINTER'],
    ['2026-04-15', 'SPRING'],
    ['2026-07-15', 'SUMMER'],
    ['2026-10-15', 'FALL'],
    ['2026-12-31', 'FALL']
  ])('places %s in %s', (date, season) => {
    expect(anilist.currentSeason(new Date(`${date}T00:00:00`)).season).toBe(season);
  });

  /**
   * Without a floor this fills with titles a handful of people rated 10,
   * which is not what anybody means by "top rated" - and the ones they do
   * mean are all far above it.
   */
  it('keeps the all-time list to titles people have actually watched', async () => {
    chartStub();
    await anilist.getChart('top');

    expect(sentVariables()).toMatchObject({
      sort: ['SCORE_DESC'], minPopularity: expect.any(Number)
    });
    expect(sentVariables().minPopularity).toBeGreaterThan(0);
  });

  it('does not constrain trending or the season by popularity', async () => {
    chartStub();
    await anilist.getChart('trending');
    expect(sentVariables().minPopularity).toBeNull();
  });

  it('returns the titles in the shape every other screen uses', async () => {
    chartStub();
    const { results } = await anilist.getChart('trending');

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ title: expect.any(String), id: expect.any(Number) });
  });

  it('asks once for a chart it has already fetched', async () => {
    chartStub();
    await anilist.getChart('trending');
    await anilist.getChart('trending');

    expect(http.request).toHaveBeenCalledTimes(1);
  });

  // Cached per season, or the row would keep answering for the season it
  // was first asked in.
  it('caches the season chart per season', async () => {
    chartStub();
    await anilist.getChart('season', { now: new Date('2026-02-01T00:00:00Z') });
    await anilist.getChart('season', { now: new Date('2026-05-01T00:00:00Z') });

    expect(http.request).toHaveBeenCalledTimes(2);
  });

  it('refuses a chart it does not know', async () => {
    await expect(anilist.getChart('whatever')).rejects.toThrow(/Unknown chart/);
  });
});
