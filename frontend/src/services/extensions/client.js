/**
 * The client's half of the extension API.
 *
 * Every call here goes to our own backend, which is what actually fetches
 * repositories and runs source code. The browser never talks to a scraped
 * site directly.
 */

import api from '../api';
import { fetchOnDevice, isAvailable } from './deviceFetch';
import { getSourceHome, setSourceHome } from './storage';

/** Unwraps the backend's error shape so callers see a usable message. */
function describe(err, fallback) {
  const data = err && err.response && err.response.data;
  if (data && data.error) {
    const error = new Error(data.error);
    error.logs = data.logs || [];
    error.requests = data.requests || [];
    // Where in the source it broke, what that means, and what to try. The
    // whole point of a failed run.
    error.diagnostics = data.diagnostics || null;
    throw error;
  }
  throw new Error(fallback);
}

/**
 * Lists the sources a repository offers.
 * @returns {Promise<{repoUrl:string, sources:Object[], skipped:Object[]}>}
 */
export async function fetchRepository(url) {
  try {
    const { data } = await api.post('/extensions/repository', { url });
    return data;
  } catch (err) {
    return describe(err, 'Could not reach the repository');
  }
}

/** Fetches a source's code and the metadata it declares. */
export async function fetchSource(codeUrl, { version, refresh } = {}) {
  try {
    const { data } = await api.post('/extensions/source', { codeUrl, version, refresh });
    return data;
  } catch (err) {
    return describe(err, 'Could not read the source');
  }
}

/** How many refused requests one run may hand to the device before we stop. */
const MAX_DEVICE_FETCHES = 4;

/**
 * How much fetched page text one round may carry back to the server.
 *
 * The server accepts 16MB; this stays under it with room for the rest of the
 * request. Without a budget here, a round that answered several large pages
 * posted more than the server would take and came back "request entity too
 * large" - which reads as a fault in the app, when the run had in fact
 * gathered everything it needed.
 *
 * Answers that do not fit are simply not sent this round. They are not
 * discarded: the next round asks for whatever is still missing, which is
 * exactly what the rounds are for.
 */
const MAX_FETCHED_BYTES = 12 * 1024 * 1024;

/** Roughly what a body will weigh once it is JSON in a request. */
const weigh = (response) => String((response && response.body) || '').length;

/** The instruction the backend sends instead of an error, when it is refused. */
function deviceFetchNeeded(err) {
  const data = err && err.response && err.response.data;
  return (err && err.response && err.response.status === 409 && data && data.needsDeviceFetch)
    ? data.needsDeviceFetch
    : null;
}

/**
 * Runs one method of one source.
 *
 * Pass `codeUrl` for an installed source, or `code` to run source text
 * directly.
 *
 * A site that refuses the server does not end the run. The backend answers
 * with the request it could not make; the device makes that one request and
 * the run is repeated with the answer supplied. Repeated rather than
 * resumed - see backend/extensions/handoff.js - so each round costs the
 * requests that already succeeded, which is why the count is capped.
 *
 * @returns {Promise<{result:*, logs:Object[], requests:Object[], durationMs:number}>}
 */
export async function runSource({
  codeUrl, code, version, method, args, source, preferences, excludeBaseUrls
}) {
  const canFetchOnDevice = isAvailable();
  const fetched = {};

  /*
   * Which of the source's homes worked last time.
   *
   * A source may name several domains running the same software, and the
   * backend keeps no per-user state - it runs, and it forgets. So this is
   * the only thing that can remember, and without it a source whose usual
   * home is down would fall through to a mirror on every single screen,
   * paying the failed attempt each time.
   *
   * Absent or stale is harmless: the rotation starts from the source's own
   * home, as it does the first time.
   */
  const sourceKey = source && source.key;
  const preferredBaseUrl = sourceKey ? getSourceHome(sourceKey) : null;

  for (let round = 0; round <= MAX_DEVICE_FETCHES; round += 1) {
    try {
      const { data } = await api.post('/extensions/run', {
        codeUrl,
        code,
        version,
        method,
        args: args || [],
        source: source || {},
        preferences: preferences || {},
        // Saying so only when it is true: the backend turns a refusal into
        // an instruction to fetch, and on the web nobody could follow it.
        allowHandoff: canFetchOnDevice,
        fetched,
        preferredBaseUrl: preferredBaseUrl || undefined,
        // Homes already found wanting on this episode: the player tried
        // every server one of them gave and none would play.
        excludeBaseUrls: Array.isArray(excludeBaseUrls) && excludeBaseUrls.length
          ? excludeBaseUrls
          : undefined
      }, {
        // Scraping several pages is slower than the app-wide default allows.
        timeout: 45000
      });

      // Remember where it worked, so the next screen starts there.
      if (sourceKey && data && data.baseUrl) setSourceHome(sourceKey, data.baseUrl);

      return data;
    } catch (err) {
      const needed = deviceFetchNeeded(err);
      if (!needed || round === MAX_DEVICE_FETCHES) return describe(err, 'The source failed to run');

      try {
        /**
         * Everything this round asked for, together.
         *
         * One at a time was the whole reason a refusal reached the user: a
         * source that asks several backends for one episode has all of them
         * refused at once, so a run needing a dozen answers needed a dozen
         * rounds against a budget of four. Fetching them together turns that
         * into one round.
         *
         * The named request leads and is answered even if the rest fail,
         * because it is the one the run stopped on and the one the message
         * describes. A sibling that cannot be fetched is left out rather
         * than failing the round: the next round asks for whatever is still
         * missing, which is exactly what the rounds are for.
         */
        const wanted = Array.isArray(err.response.data.needsDeviceFetches)
          && err.response.data.needsDeviceFetches.length
          ? err.response.data.needsDeviceFetches
          : [needed];

        const answers = await Promise.all(wanted.map(async (want) => {
          try {
            return {
              key: want.key,
              // A challenge is run in the shell's browser rather than
              // fetched; fetching one retrieves the check itself.
              response: await fetchOnDevice(want.request, { challenge: want.challenge })
            };
          } catch (siblingError) {
            // Rethrown below only if it was the request the run stopped on.
            return { key: want.key, error: siblingError };
          }
        }));

        const named = answers.find((answer) => answer.key === needed.key);
        if (named && named.error) throw named.error;

        /**
         * Kept within what the server will accept.
         *
         * The named request goes first and always: it is the one the run
         * stopped on, so a round that left it out would stop in the same
         * place. The rest are added while there is room.
         */
        const ordered = [
          ...answers.filter((answer) => answer.key === needed.key),
          ...answers.filter((answer) => answer.key !== needed.key)
        ];

        let carried = Object.values(fetched).reduce((total, r) => total + weigh(r), 0);

        ordered.forEach((answer, index) => {
          if (!answer.response) return;

          const size = weigh(answer.response);
          // The first is the named one and is never dropped, however big:
          // without it the round achieves nothing at all.
          if (index > 0 && carried + size > MAX_FETCHED_BYTES) return;

          carried += size;
          fetched[answer.key] = answer.response;
        });
      } catch (deviceError) {
        /*
         * Both roads are shut, and that is the finding.
         *
         * The server could not reach the site and neither could this device,
         * on a different network entirely. Two failures from two places mean
         * the site is not answering anybody - not that this app is broken,
         * and not that the connection is at fault.
         *
         * This used to report the two failures end to end, which read as a
         * chain of things going wrong inside the app. Someone looking at it
         * could only conclude the app was still broken; the one thing it
         * actually established - the site is down - was the thing it did not
         * say. The technical detail stays a tap away.
         */
        const serverSaid = (err.response.data && err.response.data.error)
          || 'The server could not reach the site.';

        const failure = new Error(
          'This site is not answering. Both the server and this device tried '
          + 'and neither could reach it, so the site itself is down rather '
          + 'than your connection or the app. Trying again later usually works.'
        );
        failure.requests = [];
        failure.logs = [];
        failure.diagnostics = {
          message: failure.message,
          cause: 'The site did not answer the server or this device.',
          fix: 'Two networks, the same result: the site is down or refusing '
            + 'everyone, and nothing in the app or the source can reach it '
            + 'until that changes. Other sources are unaffected.',
          source: {},
          requests: [],
          logs: [],
          failedRequests: [],
          attempts: {
            server: serverSaid,
            device: deviceError.message
          }
        };
        throw failure;
      }
    }
  }

  // Unreachable: the loop returns or throws on its last round.
  throw new Error('The source failed to run');
}

/** The method names the backend will accept. */
export async function fetchCallableMethods() {
  const { data } = await api.get('/extensions/methods');
  return data.methods;
}

/**
 * The URL a <track> element should point at for a subtitle.
 *
 * Not the source's own URL: a browser refuses a cross-origin track unless
 * the host sends CORS headers, and subtitle hosts do not. Routed through
 * the backend, which also converts SubRip to the WebVTT browsers require.
 */
export function subtitleUrl(url, referer) {
  const base = api.defaults.baseURL || '';
  const params = new URLSearchParams({ url });
  if (referer) params.set('referer', referer);
  return `${base}/extensions/subtitle?${params.toString()}`;
}
