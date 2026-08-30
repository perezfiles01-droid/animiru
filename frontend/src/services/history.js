/**
 * What you watched, and where you got to.
 *
 * Nothing recorded this before. The player carried a position across a
 * server or quality switch, read from the live element, but it was never
 * written anywhere - so closing the app lost your place and every episode
 * started from zero.
 *
 * One entry per title rather than per episode: what a person wants back is
 * "where am I in this show", and a list with twelve rows of the same anime
 * would bury it. The entry names the last episode and the position in it.
 *
 * Local, like the library, because Animiru has no accounts.
 */

const HISTORY_KEY = 'animiru.history';

/**
 * Enough to fill a history screen and then some. An unbounded list would
 * grow until localStorage refused to write, which fails silently and would
 * take the most recent entry - the one that matters - with it.
 */
const MAX_ENTRIES = 300;

/**
 * Below this, nothing was really watched: an accidental tap, or a few
 * seconds while deciding. Recording those would fill the screen with things
 * the user never chose.
 */
const MIN_SECONDS = 5;

/**
 * Within this of the end, an episode is finished rather than paused.
 * Resuming there would replay the credits and then stop.
 */
const ENDING_SECONDS = 60;

function read() {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function write(entries) {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
  } catch (err) {
    // As in the library: the screen is already updated, and a warning about
    // storage in front of a working page would be noise.
  }
  return entries;
}

/** The same identity the library uses: a source and that source's own id. */
export function historyKey(entry) {
  if (!entry) return '';
  return `${entry.providerId || ''}:${entry.itemId || entry.id || ''}`;
}

/**
 * A title reduced to something two sources can agree on.
 *
 * Sources punctuate and decorate differently - "Takt Op." against "Takt
 * op.Destiny", "Re:ZERO" against "Re Zero" - so the comparison drops
 * everything that is not a letter or a digit. Crude, and deliberately so: a
 * false match shows the wrong episode number, which the user can see and
 * correct, while being too strict silently loses their place.
 */
export function titleKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

/** Newest first, which is the order a history is read in. */
export function getHistory() {
  return read();
}

/**
 * Records where the user has got to in an episode.
 *
 * Called repeatedly while playing, so it is cheap and idempotent: one entry
 * per title, replaced in place and moved to the front.
 */
export function recordProgress(entry) {
  if (!entry || !entry.providerId || !entry.itemId) return read();

  const position = Number(entry.position) || 0;
  const duration = Number(entry.duration) || 0;
  if (position < MIN_SECONDS) return read();

  const key = historyKey(entry);
  const existing = read().find((candidate) => historyKey(candidate) === key);
  const others = read().filter((candidate) => historyKey(candidate) !== key);

  const record = {
    providerId: entry.providerId,
    providerName: entry.providerName || (existing && existing.providerName) || '',
    itemId: entry.itemId,
    title: entry.title || (existing && existing.title) || 'Untitled',
    titleKey: titleKey(entry.title || (existing && existing.title)),
    poster: entry.poster || (existing && existing.poster) || '',
    episodeId: entry.episodeId,
    episodeTitle: entry.episodeTitle || '',
    episodeNumber: Number.isFinite(Number(entry.episodeNumber))
      ? Number(entry.episodeNumber)
      : undefined,
    position,
    duration,
    // An episode watched to the end resumes at its start, not in its
    // credits - but it is still the last thing watched.
    finished: duration > 0 && position >= duration - ENDING_SECONDS,
    watchedAt: Number(entry.watchedAt) || Date.now()
  };

  return write([record, ...others].slice(0, MAX_ENTRIES));
}

/**
 * What the user last watched of a title.
 *
 * The exact source and id first. Failing that, the same title from another
 * extension: someone who watched twelve episodes on one source and opened
 * the thirteenth on another has not started the show again.
 *
 * The fallback matches on title and reports an episode *number*, which is
 * not the same as an episode - a source that numbers seasons separately can
 * mean something different by "12". The exact match is always preferred, and
 * the entry says which source it came from so the screen can too.
 */
export function findProgress({ providerId, itemId, title } = {}) {
  const entries = read();
  const key = historyKey({ providerId, itemId });

  const exact = entries.find((entry) => historyKey(entry) === key);
  if (exact) return exact;

  const wanted = titleKey(title);
  if (!wanted) return null;

  return entries.find((entry) => (entry.titleKey || titleKey(entry.title)) === wanted) || null;
}

/**
 * Where playback should start for an episode.
 *
 * Zero unless this is the episode the entry is about and it was left
 * unfinished. Resuming a *different* episode at the last position would drop
 * the user into the middle of something they have not seen.
 */
export function resumePosition(entry, episodeId) {
  if (!entry || !episodeId || entry.episodeId !== episodeId) return 0;
  if (entry.finished) return 0;
  return Number(entry.position) || 0;
}

export function removeFromHistory(entry) {
  const key = historyKey(entry);
  return write(read().filter((candidate) => historyKey(candidate) !== key));
}

export function clearHistory() {
  return write([]);
}

export const HISTORY_STORAGE_KEY = HISTORY_KEY;
export const HISTORY_LIMITS = { MAX_ENTRIES, MIN_SECONDS, ENDING_SECONDS };
