/**
 * The only way an extension reaches the network.
 *
 * Extensions are untrusted code scraping arbitrary sites, so every request
 * they make is funnelled through here and constrained: scheme, destination
 * address, redirect count, response size and wall-clock time are all capped
 * before axios is allowed anywhere near the wire.
 */

const axios = require('axios');
const dns = require('dns').promises;
const net = require('net');

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);

/**
 * Headers an extension must not be able to set. Host is the browser-identity
 * lie that lets a request bypass a proxy's routing; the rest are hop-by-hop
 * headers axios manages itself.
 */
const BLOCKED_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'upgrade',
  'proxy-authorization'
]);

/**
 * True for addresses that are not on the public internet: loopback, link
 * local, the RFC1918 ranges, CGNAT, and their IPv6 equivalents.
 *
 * This is what stops an extension asking the server to fetch its own
 * metadata endpoint or something else inside the deployment's network.
 */
function isPrivateAddress(address) {
  const version = net.isIP(address);

  if (version === 4) {
    const octets = address.split('.').map(Number);
    const [a, b] = octets;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }

  if (version === 6) {
    const normalized = address.toLowerCase();
    if (normalized === '::' || normalized === '::1') return true;
    // IPv4-mapped addresses (::ffff:10.0.0.1) carry the v4 rules with them.
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    if (/^f[cd]/.test(normalized)) return true;   // unique local
    if (/^fe[89ab]/.test(normalized)) return true; // link local
    if (/^ff/.test(normalized)) return true;       // multicast
    return false;
  }

  // Not an IP literal at all - the caller resolves the name first.
  return false;
}

/**
 * Resolves a hostname and rejects if any address it answers with is private.
 *
 * Checking every answer rather than the first matters: a hostile source can
 * publish a record that returns both a public and a private address and hope
 * the connect picks the one we did not inspect.
 */
async function assertPublicHost(hostname) {
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new Error(`Refusing to fetch a private address: ${hostname}`);
    }
    return;
  }

  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch (err) {
    throw new Error(`Could not resolve ${hostname}: ${err.message}`);
  }

  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new Error(`Refusing to fetch a private address: ${hostname} -> ${address}`);
    }
  }
}

function sanitizeHeaders(headers) {
  const clean = {};
  if (!headers || typeof headers !== 'object') return clean;

  for (const [key, value] of Object.entries(headers)) {
    if (typeof key !== 'string') continue;
    if (BLOCKED_REQUEST_HEADERS.has(key.toLowerCase())) continue;
    if (value === null || value === undefined) continue;
    clean[key] = String(value);
  }
  return clean;
}

/**
 * Validates a URL and returns it parsed. Only http and https - an extension
 * asking for file: or data: is asking for something it should not have.
 */
function parseTarget(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch (err) {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  }
  return parsed;
}

/**
 * Performs one request on an extension's behalf.
 *
 * Redirects are followed manually rather than by axios so that every hop is
 * re-checked against the private-address rule; following them inside axios
 * would let a public URL redirect us to 169.254.169.254 unexamined.
 *
 * @param {Object} options
 * @param {string} options.url
 * @param {string} [options.method]
 * @param {Object} [options.headers]
 * @param {string} [options.body]
 * @param {number} [options.timeoutMs]
 * @param {Function} [options.onRequest] called with each hop, for the maker's
 *   request log
 * @returns {Promise<{statusCode:number, body:string, headers:Object, url:string}>}
 */
async function request(options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    throw new Error(`Unsupported method: ${method}`);
  }

  const timeoutMs = Math.min(Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const headers = sanitizeHeaders(options.headers);
  const deadline = Date.now() + timeoutMs;

  let target = parseTarget(options.url);
  let currentMethod = method;
  let currentBody = options.body;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicHost(target.hostname);

    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Request timed out');

    if (typeof options.onRequest === 'function') {
      options.onRequest({ method: currentMethod, url: target.toString() });
    }

    const response = await axios({
      url: target.toString(),
      method: currentMethod,
      headers,
      data: currentBody === undefined ? undefined : currentBody,
      timeout: remaining,
      maxRedirects: 0,
      maxContentLength: MAX_RESPONSE_BYTES,
      maxBodyLength: MAX_RESPONSE_BYTES,
      responseType: 'text',
      transformResponse: [(data) => data],
      // Redirects and error statuses are both ours to interpret, so accept
      // every status and branch below rather than throwing on 404.
      validateStatus: () => true
    });

    const isRedirect = response.status >= 300 && response.status < 400 && response.headers.location;
    if (!isRedirect) {
      return {
        statusCode: response.status,
        body: typeof response.data === 'string' ? response.data : String(response.data ?? ''),
        headers: response.headers && typeof response.headers.toJSON === 'function'
          ? response.headers.toJSON()
          : { ...response.headers },
        url: target.toString()
      };
    }

    target = parseTarget(new URL(response.headers.location, target).toString());
    // 303, and the universal browser behaviour for 301/302 after a POST, is
    // to continue as a GET without the original body.
    if (currentMethod !== 'HEAD' && response.status !== 307 && response.status !== 308) {
      currentMethod = 'GET';
      currentBody = undefined;
    }
  }

  throw new Error(`Too many redirects (limit ${MAX_REDIRECTS})`);
}

module.exports = {
  request,
  isPrivateAddress,
  sanitizeHeaders,
  parseTarget,
  MAX_RESPONSE_BYTES,
  MAX_REDIRECTS,
  DEFAULT_TIMEOUT_MS
};
