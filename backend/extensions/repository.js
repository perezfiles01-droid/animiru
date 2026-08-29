/**
 * Fetching and validating extension repositories.
 *
 * A repository is a URL to an index.json listing sources, in the format
 * Mangayomi established: an array of entries, each naming a source and
 * pointing at the JavaScript file that implements it. The file itself lives
 * anywhere reachable over HTTP - in practice GitHub raw or Pages.
 *
 * Nothing here trusts the repository. The index is validated entry by entry
 * and bad entries are dropped rather than failing the whole repo, because a
 * repository with one malformed source should still install the other forty.
 */

const http = require('./http');
const { extractMetadata } = require('./sandbox');

const MAX_INDEX_BYTES = 2 * 1024 * 1024;
const MAX_SOURCES_PER_REPO = 500;
const SOURCE_CACHE_TTL_MS = 15 * 60 * 1000;
const SOURCE_CACHE_MAX_ENTRIES = 200;

/** Mangayomi's itemType values, kept so third-party indexes read correctly. */
const ITEM_TYPES = { MANGA: 0, ANIME: 1, NOVEL: 2 };

/**
 * Source code, keyed by URL and version.
 *
 * Keying on version rather than URL alone is what makes an author's version
 * bump take effect immediately while an unchanged source stays cached.
 */
const sourceCache = new Map();

function cacheGet(key) {
  const entry = sourceCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    sourceCache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value) {
  if (sourceCache.size >= SOURCE_CACHE_MAX_ENTRIES) {
    // Oldest insertion first - Map preserves that order.
    const oldest = sourceCache.keys().next().value;
    sourceCache.delete(oldest);
  }
  sourceCache.set(key, { value, expiresAt: Date.now() + SOURCE_CACHE_TTL_MS });
}

function clearCache() {
  sourceCache.clear();
}

function asString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

/**
 * Resolves a source's code URL.
 *
 * Entries carry either an explicit sourceCodeUrl or a pkgPath relative to
 * the index, which is how most published repositories are laid out.
 */
function resolveSourceUrl(entry, indexUrl) {
  const explicit = asString(entry.sourceCodeUrl).trim();
  const candidate = explicit || asString(entry.pkgPath).trim();
  if (!candidate) return null;
  try {
    return new URL(candidate, indexUrl).toString();
  } catch (err) {
    return null;
  }
}

/**
 * Normalises one index entry, or explains why it cannot be used.
 *
 * @returns {{ok:true, source:Object}|{ok:false, reason:string, name:string}}
 */
function validateEntry(entry, indexUrl) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return { ok: false, name: '(not an object)', reason: 'Entry is not an object' };
  }

  const name = asString(entry.name).trim();
  if (!name) {
    return { ok: false, name: '(unnamed)', reason: 'Entry has no name' };
  }

  const codeUrl = resolveSourceUrl(entry, indexUrl);
  if (!codeUrl) {
    return { ok: false, name, reason: 'Entry has no usable sourceCodeUrl or pkgPath' };
  }
  try {
    http.parseTarget(codeUrl);
  } catch (err) {
    return { ok: false, name, reason: err.message };
  }

  const itemType = Number.isInteger(entry.itemType) ? entry.itemType : ITEM_TYPES.ANIME;

  // Animiru plays video. A manga or novel source in a shared repository is
  // not an error, it is simply not ours, so it is reported and skipped.
  if (itemType !== ITEM_TYPES.ANIME) {
    return { ok: false, name, reason: 'Source is not an anime source' };
  }

  let baseUrl = asString(entry.baseUrl).trim();
  if (baseUrl) {
    try {
      baseUrl = http.parseTarget(baseUrl).toString();
    } catch (err) {
      return { ok: false, name, reason: `Invalid baseUrl: ${err.message}` };
    }
  }

  return {
    ok: true,
    source: {
      // The id an author assigns is only unique within their repo, so the
      // key the app stores is scoped by the repository it came from.
      key: `${indexUrl}#${asString(entry.id).trim() || name}`,
      id: asString(entry.id).trim() || name,
      name,
      lang: asString(entry.lang, 'en').trim().toLowerCase(),
      baseUrl,
      apiUrl: asString(entry.apiUrl).trim(),
      iconUrl: asString(entry.iconUrl).trim(),
      version: asString(entry.version, '0.0.0').trim(),
      itemType,
      isNsfw: Boolean(entry.isNsfw),
      hasCloudflare: Boolean(entry.hasCloudflare),
      // Declared by the author: can this source be browsed on its own, or
      // does it only answer for a title we already know about? It decides
      // which of the two data models a source takes part in.
      isMetadataCapable: entry.isMetadataCapable !== false,
      codeUrl,
      repoUrl: indexUrl
    }
  };
}

/**
 * Fetches a repository index and returns the anime sources it lists.
 *
 * @param {string} indexUrl
 * @returns {Promise<{repoUrl:string, sources:Array, skipped:Array}>}
 */
async function fetchIndex(indexUrl) {
  const target = http.parseTarget(indexUrl);
  const response = await http.request({ url: target.toString(), method: 'GET' });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Repository responded ${response.statusCode}`);
  }
  if (response.body.length > MAX_INDEX_BYTES) {
    throw new Error(`Repository index exceeds ${MAX_INDEX_BYTES} bytes`);
  }

  let parsed;
  try {
    parsed = JSON.parse(response.body);
  } catch (err) {
    throw new Error('Repository index is not valid JSON');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Repository index must be an array of sources');
  }
  if (parsed.length > MAX_SOURCES_PER_REPO) {
    throw new Error(`Repository lists more than ${MAX_SOURCES_PER_REPO} sources`);
  }

  const sources = [];
  const skipped = [];
  const seen = new Set();

  for (const entry of parsed) {
    const outcome = validateEntry(entry, response.url);
    if (!outcome.ok) {
      skipped.push({ name: outcome.name, reason: outcome.reason });
      continue;
    }
    // A repository that lists the same id twice would otherwise give the
    // user two rows that install over each other.
    if (seen.has(outcome.source.key)) {
      skipped.push({ name: outcome.source.name, reason: 'Duplicate source id in repository' });
      continue;
    }
    seen.add(outcome.source.key);
    sources.push(outcome.source);
  }

  return { repoUrl: response.url, sources, skipped };
}

/**
 * Fetches a source's JavaScript, cached by URL and version.
 *
 * @param {string} codeUrl
 * @param {Object} [options]
 * @param {string} [options.version] cache key component
 * @param {boolean} [options.refresh] bypass the cache
 * @returns {Promise<{code:string, cached:boolean, sources:Array}>}
 */
async function fetchSourceCode(codeUrl, { version = '0.0.0', refresh = false } = {}) {
  const target = http.parseTarget(codeUrl).toString();
  const key = `${target}@${version}`;

  if (!refresh) {
    const hit = cacheGet(key);
    if (hit) return { ...hit, cached: true };
  }

  const response = await http.request({ url: target, method: 'GET' });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Source code responded ${response.statusCode}`);
  }

  // Reading the declaration proves the file parses and that it is really an
  // extension, so a 404 page served as HTML fails here rather than deep
  // inside a call the user made later.
  let declared;
  try {
    declared = extractMetadata(response.body);
  } catch (err) {
    throw new Error(`Source code is not a valid extension: ${err.message}`);
  }

  const value = { code: response.body, sources: declared };
  cacheSet(key, value);
  return { ...value, cached: false };
}

module.exports = {
  fetchIndex,
  fetchSourceCode,
  validateEntry,
  resolveSourceUrl,
  clearCache,
  ITEM_TYPES,
  MAX_INDEX_BYTES,
  MAX_SOURCES_PER_REPO,
  SOURCE_CACHE_TTL_MS
};
