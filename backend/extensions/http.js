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
const https = require('https');

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

/**
 * What a request looks like when a browser makes it.
 *
 * Sites behind bot protection do not decide on the User-Agent alone. A
 * request claiming to be Chrome while sending no Accept-Language, no
 * Sec-Fetch metadata and no client hints is not a shape any browser
 * produces, and the cheapest tier of every bot check rejects it on that
 * inconsistency - which is what a 403 arriving in 150ms with no page behind
 * it means.
 *
 * Only headers a source did not set itself are filled in. A source that
 * names its own User-Agent or Accept knows something about the site that
 * this file does not.
 */
const CHROME_VERSION = '124';

const CHROME_IDENTITY = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    + `(KHTML, like Gecko) Chrome/${CHROME_VERSION}.0.0.0 Safari/537.36`,
  'Accept-Language': 'en-US,en;q=0.9',
  'sec-ch-ua': `"Chromium";v="${CHROME_VERSION}", "Google Chrome";v="${CHROME_VERSION}", `
    + '"Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"'
};

/** The Accept a browser sends for a page, which is not what it sends for JSON. */
const PAGE_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,'
  + 'image/avif,image/webp,image/apng,*/*;q=0.8';

/**
 * Sec-Fetch describes why the request is being made, and a browser sends a
 * different set for a typed-in address than for a script's fetch(). Getting
 * this the wrong way round is itself a tell, so it is decided by what the
 * request looks like: one asking for JSON, or carrying a Referer, is a page
 * calling an API; anything else is a navigation.
 */
function fetchMetadata({ wantsJson, hasReferer, method }) {
  if (wantsJson || hasReferer || method !== 'GET') {
    return {
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': hasReferer ? 'same-origin' : 'cross-site'
    };
  }

  return {
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1'
  };
}

/**
 * Fills in the headers a browser would send and the source did not.
 *
 * Matching is case-insensitive: a source setting `user-agent` has set the
 * User-Agent, and overwriting it because the capitalisation differs would
 * send two of them.
 */
function withBrowserIdentity(headers = {}, { method = 'GET' } = {}) {
  const present = new Set(Object.keys(headers).map((key) => key.toLowerCase()));
  const filled = { ...headers };

  const accept = headers.Accept || headers.accept || '';
  const wantsJson = /json/i.test(String(accept));
  const hasReferer = present.has('referer');

  const defaults = {
    ...CHROME_IDENTITY,
    Accept: PAGE_ACCEPT,
    ...fetchMetadata({ wantsJson, hasReferer, method })
  };

  for (const [key, value] of Object.entries(defaults)) {
    if (!present.has(key.toLowerCase())) filled[key] = value;
  }

  return filled;
}

/**
 * A TLS handshake shaped like a browser's.
 *
 * The second tier of bot protection does not read headers at all - it
 * fingerprints the ClientHello, and Node's cipher list and signature
 * algorithms are in an order no browser sends. Reordering them to match
 * Chrome's costs nothing and defeats a fingerprint match.
 *
 * Not a complete disguise: a browser negotiates HTTP/2 and this client
 * speaks HTTP/1.1, which a determined check can still see.
 */
const CHROME_CIPHERS = [
  'TLS_AES_128_GCM_SHA256',
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
  'ECDHE-RSA-AES128-SHA',
  'ECDHE-RSA-AES256-SHA',
  'AES128-GCM-SHA256',
  'AES256-GCM-SHA384',
  'AES128-SHA',
  'AES256-SHA'
].join(':');

const CHROME_SIGALGS = [
  'ecdsa_secp256r1_sha256',
  'rsa_pss_rsae_sha256',
  'rsa_pkcs1_sha256',
  'ecdsa_secp384r1_sha384',
  'rsa_pss_rsae_sha384',
  'rsa_pkcs1_sha384',
  'rsa_pss_rsae_sha512',
  'rsa_pkcs1_sha512'
].join(':');

const browserAgent = new https.Agent({
  keepAlive: true,
  ciphers: CHROME_CIPHERS,
  sigalgs: CHROME_SIGALGS,
  minVersion: 'TLSv1.2',
  // Chrome lets the server choose from the list it offered rather than
  // insisting on its own order.
  honorCipherOrder: false
});

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
 * @param {Function} [options.onRequest] called with each hop, for the
 *   per-request trace returned alongside a run
 * @returns {Promise<{statusCode:number, body:string, headers:Object, url:string}>}
 */
async function request(options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    throw new Error(`Unsupported method: ${method}`);
  }

  const timeoutMs = Math.min(Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  // The source's own headers win; the rest of a browser's request is filled
  // in behind them.
  const headers = withBrowserIdentity(sanitizeHeaders(options.headers), { method });
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
      httpsAgent: browserAgent,
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
  withBrowserIdentity,
  isPrivateAddress,
  sanitizeHeaders,
  parseTarget,
  MAX_RESPONSE_BYTES,
  MAX_REDIRECTS,
  DEFAULT_TIMEOUT_MS
};
