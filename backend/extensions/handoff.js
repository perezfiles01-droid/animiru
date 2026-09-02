/**
 * Handing one request back to the device that asked for the run.
 *
 * Extensions run on the Animiru server, so every request they make comes
 * from a hosting provider's address - which sites with bot protection block
 * on sight, whatever headers it carries and whatever its TLS handshake
 * looks like. A browser on the user's own connection is not blocked, because
 * it is not a datacenter.
 *
 * So a refused request is not the end of the run. The server stops, names
 * the request it could not make, and the app performs that one request from
 * the device and runs the method again with the answer supplied. The
 * extension is unchanged and unaware; only where the bytes came from
 * differs.
 *
 * Replaying the method rather than resuming it mid-run is deliberate: a
 * sandbox that could be suspended and resumed across HTTP requests would
 * have to keep a live VM per user between calls, and the server this runs on
 * is serverless. A replay costs the requests that already succeeded, which
 * is a few hundred milliseconds, and needs no state at all.
 */

const crypto = require('crypto');

/** Statuses that mean "not you", rather than an answer about the URL. */
const REFUSAL_STATUSES = new Set([403, 429, 503]);

/** How many times a run may be replayed before we call it a loop. */
const MAX_HANDOFFS = 4;

/**
 * The same address written two ways.
 *
 * A URL is named once by the source and again by the transport, and the
 * two spellings differ without the address differing: `https://site.test`
 * becomes `https://site.test/`, a default port is dropped, an empty query
 * disappears. Keys built from different spellings of one address never
 * match, so the device's answer is never found and the same request is
 * refused for ever - which is the 403 the user ends up reading.
 *
 * Anything that is not a parsable URL is left exactly as it is: it is not
 * this function's job to decide what a malformed address means.
 */
function canonicalUrl(url) {
  try {
    return new URL(String(url)).toString();
  } catch (err) {
    return String(url);
  }
}

/**
 * The name of one request.
 *
 * Method, URL and body, because a POST search for "naruto" and one for
 * "bleach" are different requests to the same address, and answering one
 * with the other's body would be worse than failing.
 */
function requestKey({ method = 'GET', url = '', body }) {
  const name = `${String(method).toUpperCase()} ${canonicalUrl(url)}`;
  if (body === undefined || body === null || body === '') return name;

  const digest = crypto.createHash('sha1').update(String(body)).digest('hex');
  return `${name} #${digest.slice(0, 16)}`;
}

/** True for a response that refused the server rather than answering it. */
function isRefusal(response) {
  return Boolean(response) && REFUSAL_STATUSES.has(Number(response.statusCode));
}

/**
 * Markers of a bot-protection challenge served as a successful response.
 *
 * The polite refusal is a status code, and isRefusal above reads it. The
 * common one is not: Cloudflare answers 200 and sends a browser check in
 * place of the page. The request was still refused - the site is judging the
 * datacenter address it came from, not the URL - but nothing in the status
 * line says so, so it used to arrive at the source's parser, which found no
 * anime in a challenge page and reported an empty result.
 *
 * Since a home is accepted on what it parses, that empty result reads as a
 * dead home: the rotation moves to the next mirror, is challenged there too,
 * and spends its entire budget learning the same thing once per domain. The
 * user waits it out and is shown nothing, while the phone that asked could
 * have loaded the page on the first attempt.
 *
 * Every marker here is machinery the challenge has to carry to run at all -
 * the script it loads, the element it mounts on, the options object it
 * reads. None of them occurs in prose.
 *
 * Deliberately NOT here: "just a moment", "checking your browser", and the
 * rest of the visible wording. They are ordinary English and a plausible
 * episode title, and matching them would hand real pages to the device for
 * ever - slower and wronger than not checking at all, and the reason a check
 * like this gets switched off a week after it lands.
 */
const CHALLENGE_MARKERS = [
  /cf-browser-verification/i,
  /\/cdn-cgi\/challenge-platform/i,
  /\b_{0,2}cf_chl(?:_opt|_tk|_jschl)?\b/i,
  /challenges\.cloudflare\.com\/turnstile/i,
  /\/\.well-known\/ddos-guard\//i,
  /<title>\s*DDoS-Guard\s*<\/title>/i
];

/**
 * What is passed as the refusal when the body, not the status, is the answer.
 */
const CHALLENGE_REFUSAL = 'browser-check';

/**
 * True for a response whose body is a browser check rather than the page.
 *
 * Only HTML is examined. A JSON API answering 200 is answering; a challenge
 * is always a document, because its whole purpose is to run a script in a
 * browser.
 */
function isChallenge(response) {
  if (!response) return false;

  const headers = response.headers || {};
  const contentType = String(
    headers['content-type'] || headers['Content-Type'] || ''
  ).toLowerCase();

  // An absent content-type is not a reason to skip the check: the body is
  // still there to be read, and a challenge without a declared type is
  // still a challenge.
  if (contentType && !contentType.includes('html')) return false;

  const body = String(response.body || '');
  if (!body) return false;

  return CHALLENGE_MARKERS.some((marker) => marker.test(body));
}

/**
 * A refusal with no status code attached.
 *
 * Answering 403 is the polite way to turn a datacenter away. The cheaper way
 * is to drop the connection - let it hang until it times out, reset it, or
 * close it mid-handshake - and plenty of sites do exactly that. AniNeko gave
 * no answer in fifteen seconds across two attempts; a subtitle host closed
 * the socket before TLS finished. Neither produced a response, so neither
 * reached isRefusal, so neither was ever offered to the device that could
 * have fetched it.
 *
 * These are the same refusal as a 403 and want the same answer. They are
 * only read this way once the transport's own retry has been spent: a
 * connection that fails once is bad luck, and http.request has already tried
 * again by the time this is asked.
 *
 * Deliberately not here: a name that does not resolve, a refused connection,
 * a private address, an unusable URL. Those are answers about the request
 * itself, and the device would fail them identically - handing one over
 * spends a round trip to learn what we already knew.
 */
const CONNECTION_REFUSALS = [
  /timeout of \d+ms exceeded/,
  /\bETIMEDOUT\b/,
  /\bECONNRESET\b/,
  /socket hang up/,
  /Client network socket disconnected/,
  /\bEPIPE\b/,
  /Request timed out/
];

/** True for an error that means "not you", rather than "not that URL". */
function isConnectionRefusal(error) {
  if (!error) return false;
  const message = String(error.message || error);
  return CONNECTION_REFUSALS.some((pattern) => pattern.test(message));
}

/**
 * Raised when a run cannot continue without the device.
 *
 * Carries everything needed to make the request somewhere else, and nothing
 * else: the route turns it into an instruction and the app follows it.
 */
class DeviceFetchRequired extends Error {
  /**
   * @param {Object} request the one request the device has to make
   * @param {number|string} refusal a status code, or the message of a
   *   connection that was refused without one
   */
  constructor(request, refusal) {
    const status = Number(refusal);
    // Three ways to be turned away and one sentence each, because the one
    // that ends up in front of the user has to describe what happened. A
    // challenge answers 200, so reading its status back would say the site
    // refused the server with a success code.
    super(refusal === CHALLENGE_REFUSAL
      ? 'The site served the server a browser check instead of the page. '
        + 'This request has to be made from the device.'
      : Number.isFinite(status) && status > 0
        ? `The site refused the server with ${status}. `
          + 'This request has to be made from the device.'
        : `The site did not answer the server (${refusal}). `
          + 'This request has to be made from the device.');
    this.name = 'DeviceFetchRequired';
    this.challenge = refusal === CHALLENGE_REFUSAL;
    this.request = request;
    this.statusCode = Number.isFinite(status) && status > 0 ? status : null;
    this.refusal = refusal;
  }
}

/**
 * Reads the responses the device already fetched, by request.
 *
 * Bodies arrive from the app as text. They are the same bytes the extension
 * would have received from the network, so nothing here interprets them.
 */
function createHandoffStore(fetched) {
  const responses = new Map();

  if (fetched && typeof fetched === 'object') {
    for (const [key, value] of Object.entries(fetched)) {
      if (!value || typeof value !== 'object') continue;

      responses.set(key, {
        statusCode: Number(value.statusCode) || 200,
        body: typeof value.body === 'string' ? value.body : '',
        headers: (value.headers && typeof value.headers === 'object') ? value.headers : {},
        url: typeof value.url === 'string' ? value.url : ''
      });
    }
  }

  return {
    /** The device's answer for this request, if it has one. */
    get(descriptor) {
      const found = responses.get(requestKey(descriptor));
      if (!found) return null;

      // A device fetch that itself was refused is an answer: the site is
      // refusing the user too, and asking again would loop.
      return { ...found, url: found.url || descriptor.url };
    },
    get size() {
      return responses.size;
    }
  };
}

module.exports = {
  createHandoffStore,
  requestKey,
  canonicalUrl,
  isRefusal,
  isChallenge,
  isConnectionRefusal,
  CONNECTION_REFUSALS,
  DeviceFetchRequired,
  REFUSAL_STATUSES,
  CHALLENGE_MARKERS,
  CHALLENGE_REFUSAL,
  MAX_HANDOFFS
};
