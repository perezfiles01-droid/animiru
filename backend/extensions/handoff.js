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
 * The name of one request.
 *
 * Method, URL and body, because a POST search for "naruto" and one for
 * "bleach" are different requests to the same address, and answering one
 * with the other's body would be worse than failing.
 */
function requestKey({ method = 'GET', url = '', body }) {
  const name = `${String(method).toUpperCase()} ${String(url)}`;
  if (body === undefined || body === null || body === '') return name;

  const digest = crypto.createHash('sha1').update(String(body)).digest('hex');
  return `${name} #${digest.slice(0, 16)}`;
}

/** True for a response that refused the server rather than answering it. */
function isRefusal(response) {
  return Boolean(response) && REFUSAL_STATUSES.has(Number(response.statusCode));
}

/**
 * Raised when a run cannot continue without the device.
 *
 * Carries everything needed to make the request somewhere else, and nothing
 * else: the route turns it into an instruction and the app follows it.
 */
class DeviceFetchRequired extends Error {
  constructor(request, statusCode) {
    super(`The site refused the server with ${statusCode}. `
      + 'This request has to be made from the device.');
    this.name = 'DeviceFetchRequired';
    this.request = request;
    this.statusCode = statusCode;
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
  isRefusal,
  DeviceFetchRequired,
  REFUSAL_STATUSES,
  MAX_HANDOFFS
};
