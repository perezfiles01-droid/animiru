/**
 * Why a failing chart has to say what AniList said.
 *
 * "Trending now" and "Top this season" showed the line "AniList responded
 * 400" on the device and nothing else. A GraphQL 400 always carries its
 * reason in the response body - the field it did not recognise, the argument
 * it rejected - and the client threw on the status code before reading any
 * of it. So the one piece of information needed to fix the query was
 * discarded by our own error handling, every time, and the screen could only
 * ever report the number.
 *
 * The other half is the request. All three charts share one query document
 * and differ only in variables, so the two that do not use a season sent
 * `season: null`, `seasonYear: null` and `popularity_greater: null`. An
 * argument explicitly set to null is not the same as an argument that was
 * not sent, and that is the one thing separating these calls from AniList's
 * documented usage. Each chart now sends only the arguments it actually
 * uses.
 */

const http = require('../extensions/http');

const anilist = require('../metadata/anilist');

/** One page of media, shaped as AniList shapes it. */
const mediaPage = (count = 2) => JSON.stringify({
  data: {
    Page: {
      media: Array.from({ length: count }, (unused, index) => ({
        id: index + 1,
        title: { romaji: `Show ${index + 1}`, english: null, native: null },
        coverImage: { large: `https://img.test/${index + 1}.jpg`, medium: null }
      }))
    }
  }
});

const respondWith = (statusCode, body) => jest.spyOn(http, 'request')
  .mockResolvedValue({ statusCode, body, headers: { 'content-type': 'application/json' }, url: 'https://graphql.anilist.co' });

/** The request body AniList was actually sent, parsed back. */
const sentPayload = (request) => JSON.parse(request.mock.calls[0][0].body);

// Charts are cached for an hour by name, so every test needs its own or the
// second one reads the first one's answer and proves nothing.
let unique = 0;
const freshPerPage = () => 5 + (unique += 1);

afterEach(() => jest.restoreAllMocks());

describe('when AniList refuses the query', () => {
  it('reports what AniList said, not just the number', async () => {
    respondWith(400, JSON.stringify({
      errors: [{ message: 'Unknown argument "popularity_greater" on field "media".' }]
    }));

    await expect(anilist.getChart('trending', { perPage: freshPerPage() }))
      .rejects.toThrow(/Unknown argument "popularity_greater"/);
  });

  it('still names the status, so a non-GraphQL failure is not hidden', async () => {
    respondWith(500, '<html>Bad Gateway</html>');

    await expect(anilist.getChart('trending', { perPage: freshPerPage() }))
      .rejects.toThrow(/500/);
  });

  it('does not pretend a bodyless failure explained itself', async () => {
    respondWith(400, '');

    await expect(anilist.getChart('trending', { perPage: freshPerPage() }))
      .rejects.toThrow(/400/);
  });

  // Rate limiting has its own sentence and its own advice, and reading the
  // body must not have replaced it.
  it('keeps the rate limit message', async () => {
    respondWith(429, JSON.stringify({ errors: [{ message: 'Too Many Requests' }] }));

    await expect(anilist.getChart('trending', { perPage: freshPerPage() }))
      .rejects.toThrow(/rate limiting/);
  });
});

/**
 * Every chart, read from the module rather than listed here, so a fourth one
 * added later is checked without anyone remembering to come back.
 */
describe.each(anilist.CHART_NAMES)('the %s chart request', (name) => {
  it('sends no argument set to null', async () => {
    const request = respondWith(200, mediaPage());

    await anilist.getChart(name, { perPage: freshPerPage() });

    const { variables } = sentPayload(request);
    const nulled = Object.entries(variables)
      .filter(([, value]) => value === null)
      .map(([key]) => key);

    expect(nulled).toEqual([]);
  });

  // A variable declared in the query but never given a value is the same
  // fault seen from the other side.
  it('declares exactly the variables it sends', async () => {
    const request = respondWith(200, mediaPage());

    await anilist.getChart(name, { perPage: freshPerPage() });

    const { query, variables } = sentPayload(request);
    const declared = [...query.matchAll(/\$([A-Za-z][A-Za-z0-9_]*)\s*:/g)].map((m) => m[1]);

    expect([...declared].sort()).toEqual(Object.keys(variables).sort());
  });

  it('still returns the media AniList sent', async () => {
    respondWith(200, mediaPage(3));

    const chart = await anilist.getChart(name, { perPage: freshPerPage() });

    expect(chart.results).toHaveLength(3);
    expect(chart.results[0].title).toBe('Show 1');
  });
});

describe('the seasonal chart', () => {
  it('still asks for a season, and says which one it got', async () => {
    const request = respondWith(200, mediaPage());

    const chart = await anilist.getChart('season', {
      perPage: freshPerPage(), now: new Date('2026-09-02T00:00:00Z')
    });

    const { variables } = sentPayload(request);
    expect(variables.season).toBe('SUMMER');
    expect(variables.seasonYear).toBe(2026);
    expect(chart.season).toBe('SUMMER');
  });
});

describe('the top chart', () => {
  it('keeps its popularity floor, which is what makes it "top rated"', async () => {
    const request = respondWith(200, mediaPage());

    await anilist.getChart('top', { perPage: freshPerPage() });

    expect(sentPayload(request).variables.minPopularity).toBeGreaterThan(0);
  });
});
