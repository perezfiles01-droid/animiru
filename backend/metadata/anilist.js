/**
 * AniList: where watch order and recommendations come from.
 *
 * Extensions cannot supply either. A Mangayomi source returns titles,
 * episodes and streams - it has no concept of a sequel, an OVA, or a show
 * being 76% recommended alongside another. Those relationships live in a
 * metadata database, so the app reads one: AniList, because its GraphQL API
 * is public, needs no key, and returns both relations and recommendations
 * in a single query.
 *
 * The join between a source and AniList is the title, and titles disagree -
 * "Tune In to the Midnight Heart" and "Mayonaka Heart Tune" are one show.
 * So matching is done across every title variant AniList knows, and the
 * entry that was matched is always returned to the caller, so a wrong match
 * is visible on screen rather than silently shaping the results.
 */

const http = require('../extensions/http');

const ENDPOINT = 'https://graphql.anilist.co';

/** AniList asks for 90 requests a minute; this is well inside that. */
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

/** How far the relation walk will go. A franchise is not 200 entries deep. */
const MAX_RELATION_NODES = 60;

const cache = new Map();

function cached(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function remember(key, value) {
  // Oldest out first. An unbounded cache in a long-lived server is a leak
  // that only shows up under real use.
  if (cache.size >= MAX_CACHE_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, { value, at: Date.now() });
  return value;
}

async function query(document, variables) {
  const response = await http.request({
    url: ENDPOINT,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: document, variables })
  });

  if (response.statusCode === 429) {
    throw new Error('AniList is rate limiting requests. Try again in a minute.');
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`AniList responded ${response.statusCode}`);
  }

  let payload;
  try {
    payload = JSON.parse(response.body);
  } catch (err) {
    throw new Error('AniList returned something that is not JSON');
  }

  // A GraphQL error arrives with a 200, so the status alone proves nothing.
  if (payload.errors && payload.errors.length) {
    throw new Error(`AniList rejected the query: ${payload.errors[0].message}`);
  }

  return payload.data || {};
}

const MEDIA_FIELDS = `
  id
  idMal
  title { romaji english native }
  format
  status
  episodes
  duration
  seasonYear
  startDate { year }
  coverImage { large medium }
  description(asHtml: false)
  genres
  averageScore
  siteUrl
`;

/** Strips the markup AniList leaves in descriptions even when asHtml is false. */
function plainText(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toMedia(node) {
  if (!node) return null;

  const titles = node.title || {};

  return {
    id: node.id,
    malId: node.idMal || null,
    title: titles.english || titles.romaji || titles.native || 'Untitled',
    titles: [titles.romaji, titles.english, titles.native].filter(Boolean),
    format: node.format || null,
    status: node.status || null,
    episodes: typeof node.episodes === 'number' ? node.episodes : null,
    year: node.seasonYear || (node.startDate && node.startDate.year) || null,
    poster: (node.coverImage && (node.coverImage.large || node.coverImage.medium)) || '',
    description: plainText(node.description),
    genres: Array.isArray(node.genres) ? node.genres : [],
    score: typeof node.averageScore === 'number' ? node.averageScore : null,
    siteUrl: node.siteUrl || ''
  };
}

/**
 * Finds the AniList entry for a title from a source.
 *
 * Returns several candidates rather than one. The best guess is first, but
 * the caller shows the rest so a wrong match can be corrected by hand -
 * which is the only remedy when two databases disagree about a name.
 */
async function search(title, { perPage = 10 } = {}) {
  const term = String(title || '').trim();
  if (!term) return [];

  const key = `search:${term.toLowerCase()}:${perPage}`;
  const hit = cached(key);
  if (hit) return hit;

  const data = await query(`
    query ($search: String, $perPage: Int) {
      Page(page: 1, perPage: $perPage) {
        media(search: $search, type: ANIME, sort: SEARCH_MATCH) { ${MEDIA_FIELDS} }
      }
    }
  `, { search: term, perPage });

  const media = ((data.Page && data.Page.media) || []).map(toMedia).filter(Boolean);
  return remember(key, media);
}

/**
 * What aired in a given season.
 *
 * Extensions cannot answer this: a Mangayomi source returns titles,
 * episodes and streams and has no notion of a season. AniList takes both as
 * query arguments, so one request does what would otherwise need a filter
 * implemented separately in every source - most of which do not have one.
 */
async function getSeason({ season, year, page = 1, perPage = 30 } = {}) {
  const seasonYear = Number(year) || null;
  const named = season ? String(season).toUpperCase() : null;

  if (!seasonYear) throw new Error('A year is needed to browse a season');

  const key = `season:${named || 'ANY'}:${seasonYear}:${page}`;
  const hit = cached(key);
  if (hit) return hit;

  const data = await query(`
    query ($season: MediaSeason, $seasonYear: Int, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage }
        media(
          season: $season,
          seasonYear: $seasonYear,
          type: ANIME,
          sort: POPULARITY_DESC
        ) { ${MEDIA_FIELDS} }
      }
    }
  `, { season: named, seasonYear, page: Number(page), perPage });

  const results = ((data.Page && data.Page.media) || []).map(toMedia).filter(Boolean);

  return remember(key, {
    results,
    hasNextPage: Boolean(data.Page && data.Page.pageInfo && data.Page.pageInfo.hasNextPage)
  });
}

/** The season AniList is in right now, which is what "this season" means. */
function currentSeason(now = new Date()) {
  const month = now.getMonth();
  const season = month <= 2 ? 'WINTER'
    : month <= 5 ? 'SPRING'
      : month <= 8 ? 'SUMMER'
        : 'FALL';

  return { season, year: now.getFullYear() };
}

/**
 * The three rows a front page opens with.
 *
 * All one shape, because they differ only in how AniList is asked to sort -
 * writing three near-identical functions would mean three places to fix the
 * next time the media fields change.
 *
 *   trending  what is being watched now, which moves daily
 *   season    this season's line-up, by popularity
 *   top       the highest scored of all time
 *
 * The score sort carries a popularity floor. Without one the list fills with
 * titles a handful of people rated 10, which is not what anybody means by
 * "top rated" - and the ones they do mean are all far above the floor.
 */
const CHARTS = {
  trending: { sort: ['TRENDING_DESC', 'POPULARITY_DESC'] },
  season: { sort: ['POPULARITY_DESC'], seasonal: true },
  top: { sort: ['SCORE_DESC'], minPopularity: 5000 }
};

async function getChart(name, { perPage = 20, now = new Date() } = {}) {
  const chart = CHARTS[name];
  if (!chart) throw new Error(`Unknown chart: ${name}`);

  const { season, year } = currentSeason(now);
  const key = `chart:${name}:${chart.seasonal ? `${season}:${year}:` : ''}${perPage}`;
  const hit = cached(key);
  if (hit) return hit;

  const data = await query(`
    query ($sort: [MediaSort], $perPage: Int, $season: MediaSeason,
           $seasonYear: Int, $minPopularity: Int) {
      Page(page: 1, perPage: $perPage) {
        media(
          type: ANIME,
          sort: $sort,
          season: $season,
          seasonYear: $seasonYear,
          popularity_greater: $minPopularity
        ) { ${MEDIA_FIELDS} }
      }
    }
  `, {
    sort: chart.sort,
    perPage: Number(perPage),
    season: chart.seasonal ? season : null,
    seasonYear: chart.seasonal ? year : null,
    minPopularity: chart.minPopularity || null
  });

  const results = ((data.Page && data.Page.media) || []).map(toMedia).filter(Boolean);

  // The season travels with the answer so the screen can name it: "Top this
  // Fall" rather than a heading that has to guess what month it is.
  return remember(key, chart.seasonal ? { results, season, year } : { results });
}

async function getMedia(id) {
  const key = `media:${id}`;
  const hit = cached(key);
  if (hit) return hit;

  const data = await query(`
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        ${MEDIA_FIELDS}
        relations {
          edges {
            relationType(version: 2)
            node { ${MEDIA_FIELDS} type }
          }
        }
      }
    }
  `, { id: Number(id) });

  if (!data.Media) throw new Error(`AniList has no anime with id ${id}`);
  return remember(key, data.Media);
}

/**
 * Relations that continue the same story, and so belong in a watch order.
 *
 * CHARACTER and OTHER are excluded deliberately: they connect shows that
 * merely share a cast or a studio, and following them turns a watch order
 * into a tour of everything the studio has made.
 */
const STORY_RELATIONS = new Set([
  'PREQUEL', 'SEQUEL', 'SIDE_STORY', 'PARENT', 'ALTERNATIVE',
  'SPIN_OFF', 'SUMMARY', 'ADAPTATION'
]);

/** Adaptations into other media are not things you watch. */
const WATCHABLE_FORMATS = new Set([
  'TV', 'TV_SHORT', 'MOVIE', 'SPECIAL', 'OVA', 'ONA', 'MUSIC'
]);

/**
 * The whole franchise, in the order it was released.
 *
 * The walk is transitive: a sequel's own sequel, and the movie hanging off
 * that, are all part of the same story. Stopping one hop from the entry the
 * user happened to open would give a different answer depending on where
 * they started, which is not an order at all.
 */
async function getWatchOrder(id) {
  const key = `watch:${id}`;
  const hit = cached(key);
  if (hit) return hit;

  const seen = new Map();
  const queue = [Number(id)];

  while (queue.length > 0 && seen.size < MAX_RELATION_NODES) {
    const current = queue.shift();
    if (seen.has(current)) continue;

    let media;
    try {
      media = await getMedia(current);
    } catch (err) {
      // One unreachable entry should not empty the whole order.
      continue;
    }

    seen.set(current, toMedia(media));

    const edges = (media.relations && media.relations.edges) || [];
    for (const edge of edges) {
      const node = edge && edge.node;
      if (!node || node.type !== 'ANIME') continue;
      if (!STORY_RELATIONS.has(edge.relationType)) continue;
      if (!WATCHABLE_FORMATS.has(node.format)) continue;
      if (!seen.has(node.id)) queue.push(node.id);
    }
  }

  const entries = [...seen.values()]
    // Oldest first, which is the order asked for. An entry with no year has
    // not aired yet, so it sorts last rather than first.
    .sort((a, b) => (a.year || Infinity) - (b.year || Infinity))
    .map((entry, index) => ({ ...entry, position: index + 1 }));

  return remember(key, entries);
}

async function getRecommendations(id, { perPage = 25 } = {}) {
  const key = `recs:${id}:${perPage}`;
  const hit = cached(key);
  if (hit) return hit;

  const data = await query(`
    query ($id: Int, $perPage: Int) {
      Media(id: $id, type: ANIME) {
        recommendations(sort: RATING_DESC, perPage: $perPage) {
          edges {
            node {
              rating
              mediaRecommendation { ${MEDIA_FIELDS} }
            }
          }
        }
      }
    }
  `, { id: Number(id), perPage });

  const edges = (data.Media && data.Media.recommendations
    && data.Media.recommendations.edges) || [];

  const rated = edges
    .map((edge) => edge && edge.node)
    .filter((node) => node && node.mediaRecommendation)
    .map((node) => ({
      ...toMedia(node.mediaRecommendation),
      votes: typeof node.rating === 'number' ? node.rating : 0
    }));

  // AniList gives a vote count, not the percentage the UI shows. Scaling it
  // against the strongest recommendation for this title is what turns "142
  // people agreed" into a figure that means something on its own.
  const top = rated.reduce((best, entry) => Math.max(best, entry.votes), 0);

  const withPercent = rated.map((entry) => ({
    ...entry,
    percent: top > 0 ? Math.round((entry.votes / top) * 100) : null
  }));

  return remember(key, withPercent);
}

function clearCache() {
  cache.clear();
}

module.exports = {
  search,
  getSeason,
  getChart,
  currentSeason,
  CHARTS,
  getMedia,
  getWatchOrder,
  getRecommendations,
  clearCache,
  toMedia,
  STORY_RELATIONS,
  WATCHABLE_FORMATS
};
