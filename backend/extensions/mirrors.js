/**
 * Trying a source's other homes when its usual one will not do.
 *
 * These sites move and go down constantly - AniNeko's origin stopped
 * answering mid-session - and several run the same software on several
 * domains. When a source names those domains, a run that cannot use one of
 * them can be tried against the next instead of failing.
 *
 * What counts as "cannot use" is the whole design. A mirror that answers
 * with somebody else's site would return HTTP 200 and parse to nothing, so
 * rotating on the status code alone would pick it, show an empty screen,
 * and call that success. A mirror is therefore accepted on the RESULT: it
 * has to produce something the app can show. A domain listed by mistake -
 * a different site entirely - can then never win. It only costs the time
 * spent asking it.
 */

const { runExtension, ExtensionError } = require('./sandbox');
const { DeviceFetchRequired } = require('./handoff');

/**
 * How long one rotation may spend, across every home it tries.
 *
 * A fixed count was the wrong limit. Three attempts is too few for a source
 * naming seventeen domains - "until one works" stops well short of working -
 * and too many when each attempt is allowed its own full timeout, since
 * three of those in series outlast any request the app is willing to wait
 * for.
 *
 * Time is the real constraint, so time is what is budgeted. Homes are tried
 * until one produces something or the budget is spent, and each attempt is
 * given only what remains rather than a fresh allowance of its own. A dead
 * domain usually fails in milliseconds - DNS does not resolve, the
 * connection is refused - so a spent budget means homes that hung, and
 * seventeen fast failures cost less than one slow one.
 */
const ROTATION_BUDGET_MS = 45000;

/**
 * The least time an attempt is worth starting with.
 *
 * Beginning a whole run with two seconds left produces a timeout rather
 * than an answer, and spends the last of the budget doing it. The first
 * attempt is always made regardless: a caller who set an unusually small
 * budget still wants one honest try.
 */
const MIN_ATTEMPT_MS = 6000;

/**
 * The methods where an empty answer means the home is no good.
 *
 * A search returning nothing is usually the truth - there is no anime by
 * that name - and rotating through every home to confirm it would make "no
 * results" the slowest screen in the app.
 *
 * The rest are different. A home page with nothing on it is a broken
 * mirror, not an empty catalogue. And an episode the user has just clicked
 * yielding no servers at all is the same: whether the home is incomplete or
 * merely stale, there is nothing to play, and asking another home is the
 * only thing that can help. That case is the whole reason the player says
 * "no other server worked" - there were none to begin with.
 */
const EMPTY_IS_FAILURE = new Set([
  'getPopular',
  'getLatestUpdates',
  'getVideoList'
]);

/** Whether an outcome is worth showing, for the method that produced it. */
function isUsable(method, result) {
  if (result === null || result === undefined) return false;
  if (!EMPTY_IS_FAILURE.has(method)) return true;

  const list = Array.isArray(result) ? result : result.list;
  return Array.isArray(list) && list.length > 0;
}

/**
 * The homes to try, in order, starting with the one the source calls its
 * own. Anything that is not an https URL is dropped rather than tried:
 * a mirror list is written by hand and a typo should not become a request.
 */
function homes(source = {}, preferred, exclude = []) {
  const seen = new Set();
  const list = [];

  /** The same address written two ways is the same home. */
  const identify = (value) => {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
      return url.host + url.pathname.replace(/\/+$/, '');
    } catch (err) {
      return null;
    }
  };

  // Homes the caller has already found wanting on this run - streams that
  // would not play, say. Asking them again would hand back the same
  // unplayable answer.
  const ruledOut = new Set(
    (Array.isArray(exclude) ? exclude : [exclude])
      .map((value) => (typeof value === 'string' ? identify(value) : null))
      .filter(Boolean)
  );

  const add = (value) => {
    if (typeof value !== 'string' || !value) return;

    const key = identify(value);
    if (!key || seen.has(key) || ruledOut.has(key)) return;

    seen.add(key);
    list.push(value.replace(/\/+$/, ''));
  };

  // One the caller knows worked last time goes first, so a source whose
  // home is down does not pay the same failure on every screen.
  add(preferred);
  add(source.baseUrl);
  for (const mirror of Array.isArray(source.mirrors) ? source.mirrors : []) add(mirror);

  return list;
}

/**
 * Runs one method, trying the source's other homes if the first will not
 * produce a usable answer.
 *
 * @returns {Promise<Object>} the outcome, with `baseUrl` naming the home
 *   that produced it so the caller can go there first next time
 */
async function runWithMirrors(options = {}) {
  const excluded = Array.isArray(options.excludeBaseUrls)
    ? options.excludeBaseUrls.filter((value) => typeof value === 'string' && value)
    : [];
  const attempts = homes(options.source, options.preferredBaseUrl, excluded);

  /*
   * Every home ruled out, and nothing left to try.
   *
   * The fallback below runs once with no chosen base, which is right for a
   * source that simply names no homes - it uses the entry it was handed.
   * It is wrong here: the caller ruled those homes out, and running without
   * a choice would go straight back to the one they just rejected and hand
   * back the same unplayable answer.
   */
  if (excluded.length && !attempts.length) {
    throw new ExtensionError(
      `No other home left to try for ${options.method}()`
    );
  }
  const tried = [];

  // The first failure is the one worth reporting if every home fails: it is
  // the source's own, and the others are consolation attempts.
  let firstError = null;
  let firstEmpty = null;

  /*
   * One deadline for the whole rotation, not one per home.
   *
   * Each attempt is handed what is left of it, so trying another home can
   * never extend how long the caller waits - which is what makes trying
   * every home affordable.
   */
  const deadline = Date.now() + (Number(options.timeoutMs) || ROTATION_BUDGET_MS);
  let ranOut = false;

  for (const baseUrl of attempts.length ? attempts : [undefined]) {
    const remaining = deadline - Date.now();
    if (tried.length && remaining < MIN_ATTEMPT_MS) {
      ranOut = true;
      break;
    }

    try {
      const outcome = await runExtension({
        ...options,
        baseUrl,
        timeoutMs: Math.max(remaining, MIN_ATTEMPT_MS)
      });
      tried.push({ baseUrl, ok: true });

      if (isUsable(options.method, outcome.result)) {
        return { ...outcome, baseUrl: baseUrl || null, mirrorsTried: tried };
      }
      if (!firstEmpty) firstEmpty = { ...outcome, baseUrl: baseUrl || null };
    } catch (err) {
      // An instruction to the app, not a verdict on this home. Handing it
      // back is the designed answer to a site that refuses the server, and
      // the run is replayed with what the device fetched.
      if (err instanceof DeviceFetchRequired) throw err;

      tried.push({ baseUrl, ok: false, error: err.message });
      if (!firstError) firstError = err;
    }
  }

  // Nothing usable anywhere. An empty answer is still an answer, so it is
  // preferred over an error the user can do nothing about.
  if (firstEmpty) return { ...firstEmpty, mirrorsTried: tried };
  if (firstError) throw firstError;

  // Reached only when the budget ran out before any home answered either
  // way. Saying so distinguishes "they were all slow" from "they were all
  // wrong", which are different problems with different fixes.
  if (ranOut) {
    throw new ExtensionError(
      `Ran out of time trying homes for ${options.method}() - ${tried.length} tried`
    );
  }

  throw new ExtensionError(`No usable home for ${options.method}()`);
}

module.exports = {
  runWithMirrors,
  homes,
  isUsable,
  ROTATION_BUDGET_MS,
  MIN_ATTEMPT_MS,
  EMPTY_IS_FAILURE
};
