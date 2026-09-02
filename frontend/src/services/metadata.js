import api from './api';

/**
 * Watch order and recommendations, from AniList by way of our backend.
 *
 * The hard part is not fetching but matching: a source's title and AniList's
 * title are often different names for the same show. The match is therefore
 * a guess that the user can overrule, and an overruled match is remembered
 * per title so it only has to be corrected once.
 */

const MATCH_KEY = 'animiru.anilistMatches';

function readMatches() {
  try {
    const raw = window.localStorage.getItem(MATCH_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    return {};
  }
}

/**
 * Keyed by source and id rather than by title: two sources can list the
 * same show under different names, and a title is not stable enough to key
 * a correction the user made once.
 */
export function matchKey(providerId, itemId) {
  return `${providerId || ''}:${itemId || ''}`;
}

export function getSavedMatch(providerId, itemId) {
  const saved = readMatches()[matchKey(providerId, itemId)];
  return typeof saved === 'number' ? saved : null;
}

export function saveMatch(providerId, itemId, anilistId) {
  const matches = readMatches();
  matches[matchKey(providerId, itemId)] = Number(anilistId);
  try {
    window.localStorage.setItem(MATCH_KEY, JSON.stringify(matches));
  } catch (err) {
    // A correction that cannot be stored still applies to this visit.
  }
  return Number(anilistId);
}

export function forgetMatch(providerId, itemId) {
  const matches = readMatches();
  delete matches[matchKey(providerId, itemId)];
  try {
    window.localStorage.setItem(MATCH_KEY, JSON.stringify(matches));
  } catch (err) { /* as above */ }
}

/** Turns any failure into one sentence the screen can show. */
function reason(err) {
  const fromServer = err && err.response && err.response.data && err.response.data.error;
  return fromServer || (err && err.message) || 'AniList could not be reached';
}

export async function searchMetadata(title) {
  try {
    const { data } = await api.get('/metadata/search', { params: { title } });
    return { results: data.results || [] };
  } catch (err) {
    return { results: [], error: reason(err) };
  }
}

export async function getSeason({ season, year, page }) {
  try {
    const { data } = await api.get('/metadata/season', { params: { season, year, page } });
    return { results: data.results || [], hasNextPage: Boolean(data.hasNextPage) };
  } catch (err) {
    return { results: [], hasNextPage: false, error: reason(err) };
  }
}

/**
 * One of the front page's rows.
 *
 * Same failure shape as everything else here: a chart that cannot be
 * fetched is an empty row with a reason, never a broken page. AniList being
 * unreachable must not stop the source catalogue below it from rendering.
 */
export async function getChart(name, { perPage } = {}) {
  try {
    const { data } = await api.get(`/metadata/chart/${name}`, { params: { perPage } });
    return {
      results: data.results || [],
      season: data.season || null,
      year: data.year || null
    };
  } catch (err) {
    return { results: [], error: reason(err) };
  }
}

export async function getWatchOrder(anilistId) {
  try {
    const { data } = await api.get('/metadata/watch-order', { params: { id: anilistId } });
    return { entries: data.entries || [] };
  } catch (err) {
    return { entries: [], error: reason(err) };
  }
}

export async function getRecommendations(anilistId) {
  try {
    const { data } = await api.get('/metadata/recommendations', { params: { id: anilistId } });
    return { results: data.results || [] };
  } catch (err) {
    return { results: [], error: reason(err) };
  }
}

/**
 * The AniList entry for a title from a source: the correction if one was
 * made, otherwise the best guess.
 *
 * Returns the candidates alongside it so the screen can show what it
 * matched and offer the alternatives, rather than presenting a guess as
 * fact.
 */
export async function resolveMatch({ providerId, itemId, title }) {
  const saved = getSavedMatch(providerId, itemId);
  const { results, error } = await searchMetadata(title);

  if (error && !saved) return { match: null, candidates: [], error };

  const chosen = saved
    ? results.find((entry) => entry.id === saved) || { id: saved, title: `AniList #${saved}` }
    : results[0] || null;

  return {
    match: chosen || null,
    candidates: results,
    // A saved choice is worth saying out loud, so it is clear why the screen
    // shows this entry rather than the obvious one.
    corrected: Boolean(saved)
  };
}

/**
 * Where to go when an AniList title is tapped.
 *
 * AniList entries carry no source id - they are not from a source at all -
 * so there is nothing to link straight to; the app searches for the title
 * instead.
 *
 * Every source, not the one the reader came from. Scoping to the
 * originating source was the earlier behaviour and it was wrong in the case
 * that matters: a recommendation is a show you have not watched, so the
 * source you happen to be using is no more likely to carry it than any
 * other, and hiding the fifteen that might have it to favour the one that
 * might not is the opposite of helpful.
 */
export function findOnSourcesHref(title) {
  return `/?q=${encodeURIComponent(String(title || '').trim())}`;
}

export const METADATA_MATCH_KEY = MATCH_KEY;
