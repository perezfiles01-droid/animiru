/**
 * Talks to AniList's public GraphQL API straight from the browser.
 *
 * The backend's /api/anime/* routes were a thin proxy around exactly these
 * queries, which meant browsing needed a deployed server. AniList needs no
 * API key and sends Access-Control-Allow-Origin, so the app can call it
 * directly and work with no backend at all.
 *
 * Deliberately does NOT use services/api.js: that instance carries a baseURL
 * and interceptors that attach an Authorization header and redirect to /login
 * on 401. Neither belongs on a third-party request.
 *
 * The backend is still required for auth and watchlist.
 */

const ANILIST_URL = 'https://graphql.anilist.co';
const CACHE_TTL = 3600000; // 1 hour, matching the old server-side cache

const cache = new Map();

function readCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function writeCache(key, value) {
  cache.set(key, { value, at: Date.now() });
}

async function query(graphql, variables, cacheKey) {
  const cached = cacheKey && readCache(cacheKey);
  if (cached) return cached;

  let response;
  try {
    response = await fetch(ANILIST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ query: graphql, variables })
    });
  } catch (err) {
    // fetch only rejects on a transport failure, so this is genuinely
    // "the request never completed" rather than an error status.
    throw new Error(
      'Could not reach AniList. Check your internet connection and try again.'
    );
  }

  if (response.status === 429) {
    throw new Error('Too many requests to AniList. Please wait a moment.');
  }

  if (!response.ok) {
    throw new Error(`AniList request failed (HTTP ${response.status}).`);
  }

  const payload = await response.json();

  if (payload.errors && payload.errors.length > 0) {
    throw new Error(payload.errors[0].message || 'AniList returned an error.');
  }

  const data = payload.data;
  if (cacheKey) writeCache(cacheKey, data);
  return data;
}

const TRENDING_QUERY = `
  query($page: Int) {
    Page(page: $page, perPage: 20) {
      pageInfo { hasNextPage currentPage lastPage }
      media(type: ANIME, sort: TRENDING_DESC) {
        id
        title { romaji english }
        coverImage { large }
        meanScore
        episodes
        genres
        status
      }
    }
  }
`;

const SEARCH_QUERY = `
  query($search: String, $page: Int) {
    Page(page: $page, perPage: 20) {
      pageInfo { hasNextPage currentPage lastPage }
      media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
        id
        title { romaji english }
        coverImage { large }
        meanScore
        episodes
        genres
        status
      }
    }
  }
`;

const DETAILS_QUERY = `
  query($id: Int) {
    Media(id: $id, type: ANIME) {
      id
      title { romaji english native }
      description
      startDate { year month day }
      bannerImage
      coverImage { large medium }
      genres
      meanScore
      popularity
      episodes
      duration
      status
      studios { nodes { name } }
      trailer { id site }
    }
  }
`;

/** Trending anime. Resolves to AniList's Page object: { pageInfo, media }. */
export async function getTrending(page = 1) {
  const data = await query(TRENDING_QUERY, { page }, `trending_${page}`);
  return data.Page;
}

/** Search by title. Resolves to AniList's Page object: { pageInfo, media }. */
export async function searchAnime(search, page = 1) {
  const data = await query(
    SEARCH_QUERY,
    { search, page },
    `search_${search}_${page}`
  );
  return data.Page;
}

/** Full record for one anime. Resolves to AniList's Media object. */
export async function getAnimeById(id) {
  const numericId = parseInt(id, 10);
  if (Number.isNaN(numericId)) {
    throw new Error('Invalid anime id.');
  }
  const data = await query(DETAILS_QUERY, { id: numericId }, `anime_${numericId}`);
  if (!data.Media) {
    throw new Error('Anime not found.');
  }
  return data.Media;
}
