/**
 * Making one request from this device instead of from the server.
 *
 * Extensions run on the Animiru server, so their requests come from a
 * hosting provider's address, which sites with bot protection refuse
 * outright. This device is on an ordinary connection and is not refused.
 * When the server is turned away it names the request it could not make and
 * the app performs that one request here.
 *
 * Only the Android app can do this. The page is served from a virtual origin
 * inside the WebView, so a fetch() to a site is cross-origin and the browser
 * will not let us read the response; the native bridge is not bound by that.
 * On the web there is no bridge, `isAvailable` is false, and a refusal stays
 * a refusal.
 */

const BRIDGE = '__animiruDeviceFetch';

/** How long to wait for the device before giving up on the request. */
const TIMEOUT_MS = 30000;

let nextId = 1;
const waiting = new Map();

/** The native object, when this build has one. */
function bridge() {
  return (typeof window !== 'undefined' && window.AnimiruDeviceFetch) || null;
}

export function isAvailable() {
  const native = bridge();
  if (!native || typeof native.request !== 'function') return false;

  try {
    return native.isAvailable() !== false;
  } catch (err) {
    return false;
  }
}

/**
 * Installs the callback the native side answers through.
 *
 * A property on window rather than a message event: the bridge delivers by
 * evaluating a script in this page, and a function it can call directly is
 * the whole protocol.
 */
function listen() {
  if (typeof window === 'undefined' || window[BRIDGE]) return;

  window[BRIDGE] = {
    deliver(id, json) {
      const pending = waiting.get(String(id));
      if (!pending) return;

      waiting.delete(String(id));
      try {
        pending.resolve(JSON.parse(json));
      } catch (err) {
        pending.resolve({ ok: false, error: 'The device sent back something unreadable' });
      }
    }
  };
}

/**
 * Performs one request on the device.
 *
 * Resolves with the response whatever its status - a 403 from the device is
 * an answer too, and means the site is refusing the user as well - and
 * rejects only when the request could not be made at all.
 */
export async function fetchOnDevice(request) {
  const native = bridge();
  if (!native) throw new Error('This build cannot fetch from the device');

  listen();

  const id = String(nextId);
  nextId += 1;

  const answer = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      reject(new Error('The device took too long to fetch that request'));
    }, TIMEOUT_MS);

    waiting.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      }
    });

    try {
      native.request(id, JSON.stringify({
        url: request.url,
        method: request.method || 'GET',
        headers: request.headers || {},
        body: request.body === undefined ? null : request.body
      }));
    } catch (err) {
      clearTimeout(timer);
      waiting.delete(id);
      reject(err);
    }
  });

  if (!answer || answer.ok !== true) {
    throw new Error((answer && answer.error) || 'The device could not make that request');
  }

  return {
    statusCode: answer.statusCode,
    body: answer.body || '',
    headers: answer.headers || {},
    url: answer.url || request.url
  };
}

export const TESTING = { waiting, BRIDGE };
