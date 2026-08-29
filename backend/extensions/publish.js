/**
 * Publishing a source to the official extension repository.
 *
 * One repository, one token, held here on the server. An author writes a
 * source in the maker and publishes it; this commits the file and rewrites
 * index.json so the app - and anyone else pointed at the repo - sees it.
 *
 * The token is ours, which means every publish is effectively us vouching
 * for the content. That is the reason for the author allowlist below: the
 * gate is the whole point, not a formality.
 */

const axios = require('axios');
const jwt = require('jsonwebtoken');
const { extractMetadata } = require('./sandbox');

const GITHUB_API = 'https://api.github.com';
const MAX_CODE_BYTES = 512 * 1024;

/** A file name that cannot escape the sources directory. */
const SAFE_FILENAME = /^[a-z0-9][a-z0-9._-]{0,63}\.js$/;

function config() {
  return {
    token: process.env.GITHUB_TOKEN,
    repo: process.env.EXTENSION_REPO,
    branch: process.env.EXTENSION_BRANCH || 'main',
    indexPath: process.env.EXTENSION_INDEX_PATH || 'index.json',
    sourcesDir: (process.env.EXTENSION_SOURCES_DIR || 'sources').replace(/^\/+|\/+$/g, ''),
    // Comma-separated emails. Empty means nobody can publish, which is the
    // right default for a token that writes to a repository we own.
    authors: String(process.env.EXTENSION_AUTHORS || '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  };
}

/** True when publishing has been configured at all. */
function isConfigured() {
  const { token, repo } = config();
  return Boolean(token && repo);
}

class PublishError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'PublishError';
    this.status = status;
  }
}

/**
 * Identifies the author of a request and checks they may publish.
 *
 * @returns {{email:string}}
 */
function authorize(req) {
  const { authors } = config();

  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    throw new PublishError('Sign in to publish a source', 401);
  }

  let decoded;
  try {
    decoded = jwt.verify(header.slice(7), process.env.JWT_SECRET);
  } catch (err) {
    throw new PublishError('Your session has expired, sign in again', 401);
  }

  const email = String(decoded.email || '').toLowerCase();
  if (!email || !authors.includes(email)) {
    throw new PublishError('This account is not allowed to publish sources', 403);
  }

  return { email };
}

function github(path, { method = 'GET', body } = {}) {
  const { token, repo } = config();
  return axios({
    url: `${GITHUB_API}/repos/${repo}/${path}`,
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Animiru'
    },
    data: body,
    validateStatus: () => true
  });
}

/**
 * Reads a file from the repository.
 *
 * @returns {Promise<{content:string, sha:string}|null>} null when absent,
 *   which is how a first publish is distinguished from an update
 */
async function readFile(path) {
  const { branch } = config();
  const response = await github(
    `contents/${encodeURI(path)}?ref=${encodeURIComponent(branch)}`
  );

  if (response.status === 404) return null;
  if (response.status !== 200) {
    throw new PublishError(
      `GitHub refused to read ${path}: ${response.data && response.data.message}`,
      502
    );
  }

  return {
    content: Buffer.from(response.data.content || '', 'base64').toString('utf8'),
    sha: response.data.sha
  };
}

async function writeFile(path, content, message, sha) {
  const { branch } = config();
  const response = await github(`contents/${encodeURI(path)}`, {
    method: 'PUT',
    body: {
      message,
      branch,
      content: Buffer.from(content, 'utf8').toString('base64'),
      // Omitting sha on an existing file is how GitHub detects a conflicting
      // write, so it is always sent when we have one.
      ...(sha ? { sha } : {})
    }
  });

  if (response.status !== 200 && response.status !== 201) {
    const detail = response.data && response.data.message;
    if (response.status === 409 || /does not match/i.test(String(detail))) {
      throw new PublishError(
        'The repository changed while you were publishing. Reload and try again.',
        409
      );
    }
    throw new PublishError(`GitHub refused to write ${path}: ${detail}`, 502);
  }

  return response.data.content && response.data.content.sha;
}

/**
 * Builds the index entry for a published source from what its own file
 * declares, so the listing cannot drift from the code.
 */
function buildIndexEntry(declared, { fileName, sourcesDir }) {
  const name = String(declared.name || '').trim();
  if (!name) throw new PublishError('The source must declare a name');

  return {
    name,
    id: declared.id !== undefined ? declared.id : name,
    lang: String(declared.lang || 'en').toLowerCase(),
    baseUrl: declared.baseUrl || '',
    apiUrl: declared.apiUrl || '',
    iconUrl: declared.iconUrl || '',
    version: String(declared.version || '0.0.1'),
    itemType: Number.isInteger(declared.itemType) ? declared.itemType : 1,
    isNsfw: Boolean(declared.isNsfw),
    hasCloudflare: Boolean(declared.hasCloudflare),
    isMetadataCapable: declared.isMetadataCapable !== false,
    pkgPath: `${sourcesDir}/${fileName}`
  };
}

/** Replaces an entry with the same pkgPath, or appends a new one. */
function upsertEntry(index, entry) {
  const next = Array.isArray(index) ? [...index] : [];
  const position = next.findIndex((existing) => existing && existing.pkgPath === entry.pkgPath);

  if (position === -1) {
    next.push(entry);
  } else {
    next[position] = entry;
  }

  return next;
}

/**
 * Commits a source and its index entry.
 *
 * @param {Object} options
 * @param {string} options.fileName
 * @param {string} options.code
 * @param {string} options.email the author, for the commit message
 * @returns {Promise<{path:string, entry:Object, created:boolean}>}
 */
async function publishSource({ fileName, code, email }) {
  if (!isConfigured()) {
    throw new PublishError('Publishing is not configured on this server', 503);
  }

  const name = String(fileName || '').trim().toLowerCase();
  if (!SAFE_FILENAME.test(name)) {
    throw new PublishError(
      'File name must be lowercase letters, digits, dot, dash or underscore, ending in .js'
    );
  }

  const body = String(code || '');
  if (!body.trim()) throw new PublishError('There is no code to publish');
  if (body.length > MAX_CODE_BYTES) {
    throw new PublishError(`Source exceeds ${MAX_CODE_BYTES} bytes`);
  }

  // Running the declaration proves the file parses and really is an
  // extension before anything is committed. Publishing something that
  // cannot load would break the repository for everyone using it.
  let declared;
  try {
    declared = extractMetadata(body);
  } catch (err) {
    throw new PublishError(`The source does not load: ${err.message}`);
  }
  if (declared.length === 0) {
    throw new PublishError('The source declares no mangayomiSources entry');
  }

  const { sourcesDir, indexPath } = config();
  const entry = buildIndexEntry(declared[0], { fileName: name, sourcesDir });
  const path = `${sourcesDir}/${name}`;

  const existing = await readFile(path);
  await writeFile(
    path,
    body,
    `${existing ? 'Update' : 'Add'} ${entry.name} v${entry.version} (${email})`,
    existing && existing.sha
  );

  const indexFile = await readFile(indexPath);
  let index = [];
  if (indexFile) {
    try {
      index = JSON.parse(indexFile.content);
    } catch (err) {
      throw new PublishError('The repository index is not valid JSON; fix it by hand', 502);
    }
  }

  await writeFile(
    indexPath,
    `${JSON.stringify(upsertEntry(index, entry), null, 2)}\n`,
    `Index ${entry.name} v${entry.version} (${email})`,
    indexFile && indexFile.sha
  );

  return { path, entry, created: !existing };
}

module.exports = {
  publishSource,
  authorize,
  isConfigured,
  buildIndexEntry,
  upsertEntry,
  PublishError,
  SAFE_FILENAME
};
