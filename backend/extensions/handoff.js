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
    // Both are the site turning this server away; only one of them spent a
    // response saying so, and the sentence has to read correctly either way.
    super(Number.isFinite(status) && status > 0
      ? `The site refused the server with ${status}. `
        + 'This request has to be made from the device.'
      : `The site did not answer the server (${refusal}). `
        + 'This request has to be made from the device.');
    this.name = 'DeviceFetchRequired';
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
  isConnectionRefusal,
  CONNECTION_REFUSALS,
  DeviceFetchRequired,
  REFUSAL_STATUSES,
  MAX_HANDOFFS
};
