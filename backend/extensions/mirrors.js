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
 * How many homes one run may try.
 *
 * Each attempt is a whole run, so the budget is real: three at fifteen
 * seconds apiece already approaches the run's own deadline. A source with
 * eight mirrors does not get eight tries; it gets the first three that have
 * not already been ruled out.
 */
const MAX_ATTEMPTS = 3;

/**
 * The methods where an empty answer means the mirror is no good.
 *
 * A search returning nothing is usually the truth - there is no anime by
 * that name - and rotating through every mirror to confirm it would make
 * "no results" the slowest screen in the app. Browsing is different: a home
 * page with nothing on it is a broken mirror, not an empty catalogue.
 */
const BROWSE_METHODS = new Set(['getPopular', 'getLatestUpdates']);

/** Whether an outcome is worth showing, for the method that produced it. */
function isUsable(method, result) {
  if (result === null || result === undefined) return false;
  if (!BROWSE_METHODS.has(method)) return true;

  const list = Array.isArray(result) ? result : result.list;
  return Array.isArray(list) && list.length > 0;
}

/**
 * The homes to try, in order, starting with the one the source calls its
 * own. Anything that is not an https URL is dropped rather than tried:
 * a mirror list is written by hand and a typo should not become a request.
 */
function homes(source = {}, preferred) {
  const seen = new Set();
  const list = [];

  const add = (value) => {
    if (typeof value !== 'string' || !value) return;
    let url;
    try {
      url = new URL(value);
    } catch (err) {
      return;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return;

    const key = url.host + url.pathname.replace(/\/+$/, '');
    if (seen.has(key)) return;
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
  const candidates = homes(options.source, options.preferredBaseUrl);
  const attempts = candidates.slice(0, MAX_ATTEMPTS);
  const tried = [];

  // The first failure is the one worth reporting if every home fails: it is
  // the source's own, and the others are consolation attempts.
  let firstError = null;
  let firstEmpty = null;

  for (const baseUrl of attempts.length ? attempts : [undefined]) {
    try {
      const outcome = await runExtension({ ...options, baseUrl });
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

  throw new ExtensionError(`No usable home for ${options.method}()`);
}

module.exports = { runWithMirrors, homes, isUsable, MAX_ATTEMPTS, BROWSE_METHODS };
