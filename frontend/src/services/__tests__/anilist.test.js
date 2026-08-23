import { getTrending, searchAnime, getAnimeById } from '../anilist';

/**
 * These cover the wrapper logic around AniList - cache behaviour, error
 * translation and the shape callers receive - by stubbing fetch. They
 * deliberately do not hit the network, so they stay deterministic and offline.
 */

function jsonResponse(body, { status = 200, ok = true } = {}) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body)
  });
}

const TRENDING_BODY = {
  data: {
    Page: {
      pageInfo: { hasNextPage: true, currentPage: 1, lastPage: 9 },
      media: [{ id: 1, title: { romaji: 'Cowboy Bebop' } }]
    }
  }
};

beforeEach(() => {
  global.fetch = jest.fn();
});

afterEach(() => {
  delete global.fetch;
});

describe('getTrending', () => {
  test('returns the Page object', async () => {
    global.fetch.mockReturnValue(jsonResponse(TRENDING_BODY));

    const page = await getTrending(1);

    expect(page.media).toHaveLength(1);
    expect(page.pageInfo.hasNextPage).toBe(true);
  });

  test('posts to AniList as JSON', async () => {
    global.fetch.mockReturnValue(jsonResponse(TRENDING_BODY));

    await getTrending(11);

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('https://graphql.anilist.co');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body).variables).toEqual({ page: 11 });
  });

  test('serves a repeat call from cache instead of refetching', async () => {
    global.fetch.mockReturnValue(jsonResponse(TRENDING_BODY));

    await getTrending(2);
    await getTrending(2);

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('does not send an Authorization header to a third party', async () => {
    global.fetch.mockReturnValue(jsonResponse(TRENDING_BODY));

    await getTrending(3);

    const [, init] = global.fetch.mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
  });
});

describe('searchAnime', () => {
  test('passes the search term through', async () => {
    global.fetch.mockReturnValue(jsonResponse(TRENDING_BODY));

    await searchAnime('bebop', 1);

    const [, init] = global.fetch.mock.calls[0];
    expect(JSON.parse(init.body).variables).toEqual({
      search: 'bebop',
      page: 1
    });
  });
});

describe('getAnimeById', () => {
  test('returns the Media object', async () => {
    global.fetch.mockReturnValue(
      jsonResponse({ data: { Media: { id: 5, episodes: 26 } } })
    );

    await expect(getAnimeById('5')).resolves.toEqual({ id: 5, episodes: 26 });
  });

  test('rejects a non-numeric id without calling the network', async () => {
    await expect(getAnimeById('abc')).rejects.toThrow('Invalid anime id');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('reports a missing anime rather than returning null', async () => {
    global.fetch.mockReturnValue(jsonResponse({ data: { Media: null } }));

    await expect(getAnimeById('999999')).rejects.toThrow('Anime not found');
  });
});

describe('error translation', () => {
  test('a transport failure explains the connection, not the exception', async () => {
    global.fetch.mockReturnValue(Promise.reject(new TypeError('Failed to fetch')));

    // The bare "Network Error" this replaces told the user nothing actionable.
    await expect(getTrending(101)).rejects.toThrow(/internet connection/i);
  });

  test('rate limiting is called out specifically', async () => {
    global.fetch.mockReturnValue(
      jsonResponse({}, { status: 429, ok: false })
    );

    await expect(getTrending(102)).rejects.toThrow(/Too many requests/i);
  });

  test('a GraphQL error surfaces the API message', async () => {
    global.fetch.mockReturnValue(
      jsonResponse({ errors: [{ message: 'Invalid query' }] })
    );

    await expect(getTrending(103)).rejects.toThrow('Invalid query');
  });

  test('a failed request is not cached', async () => {
    global.fetch.mockReturnValueOnce(
      jsonResponse({}, { status: 500, ok: false })
    );
    await expect(getTrending(104)).rejects.toThrow(/HTTP 500/);

    global.fetch.mockReturnValueOnce(jsonResponse(TRENDING_BODY));
    await expect(getTrending(104)).resolves.toHaveProperty('media');
  });
});
