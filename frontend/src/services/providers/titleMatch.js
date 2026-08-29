/**
 * Matching an AniList title to an entry in a source's own catalogue.
 *
 * Sources that carry no metadata of their own are asked for episodes of a
 * title we already know about, which means guessing which of their search
 * results is the same show. That guess is wrong often enough that it must be
 * visible and overridable rather than silent - so this module ranks
 * candidates and reports how confident it is, and the UI shows the choice.
 */

/**
 * Reduces a title to something comparable.
 *
 * Sources and AniList disagree constantly about punctuation, romanisation
 * and how a season is written, so all of that is normalised away before
 * anything is compared.
 */
export function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    // Season and part markers are the single biggest source of noise:
    // "Attack on Titan Season 2" vs "Attack on Titan 2nd Season".
    .replace(/\b(\d+)(st|nd|rd|th)\s+season\b/g, 'season $1')
    .replace(/\bseason\s*(\d+)\b/g, 'season $1')
    .replace(/\bpart\s*(\d+)\b/g, 'part $1')
    .replace(/\b(tv|ova|ona|special|movie|dub|sub|subbed|dubbed|uncensored)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokens(title) {
  return normalizeTitle(title).split(' ').filter(Boolean);
}

/**
 * Similarity of two titles, from 0 to 1.
 *
 * Token overlap rather than edit distance, because the usual difference is a
 * missing or extra word - a subtitle, a "TV", a season marker - not a
 * misspelling, and edit distance punishes that far too heavily.
 */
export function similarity(a, b) {
  const left = normalizeTitle(a);
  const right = normalizeTitle(b);

  if (!left || !right) return 0;
  if (left === right) return 1;

  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;

  const rightPool = [...rightTokens];
  let shared = 0;
  for (const token of leftTokens) {
    const index = rightPool.indexOf(token);
    if (index !== -1) {
      shared += 1;
      rightPool.splice(index, 1);
    }
  }

  // Dividing by the longer side means extra words on either title cost
  // something, so "Naruto" does not score 1.0 against "Naruto Shippuden".
  const overlap = shared / Math.max(leftTokens.length, rightTokens.length);

  // A title that is a clean prefix of the other is usually the same work
  // with a subtitle attached, which deserves better than raw overlap.
  const prefixBonus = (right.startsWith(left) || left.startsWith(right)) ? 0.1 : 0;

  return Math.min(1, overlap + prefixBonus);
}

/** Confidence below which a match is offered but not used automatically. */
export const CONFIDENT_MATCH = 0.75;

/**
 * Ranks a source's search results against the titles AniList knows a show by.
 *
 * All of AniList's titles are tried - romaji, english and native - because
 * which one a given source uses is unpredictable, and the best score across
 * them is the honest one.
 *
 * @param {string[]} titles the names AniList has for the show
 * @param {Object[]} candidates catalogue items from the source
 * @returns {{best:Object|null, confident:boolean, ranked:Object[]}}
 */
export function rankCandidates(titles, candidates) {
  const names = (Array.isArray(titles) ? titles : [titles]).filter(Boolean);

  const ranked = (candidates || [])
    .map((candidate) => ({
      candidate,
      score: names.reduce(
        (best, name) => Math.max(best, similarity(name, candidate.title)),
        0
      )
    }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0] || null;

  return {
    best: best && best.score > 0 ? best.candidate : null,
    score: best ? best.score : 0,
    confident: Boolean(best && best.score >= CONFIDENT_MATCH),
    ranked
  };
}
