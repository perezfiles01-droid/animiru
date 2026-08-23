/**
 * Jellyfin provider - plays from a media server the user runs and controls.
 *
 * This is the "user-authorized source" case: the server is theirs, the
 * library is theirs, and the HTTP API is publicly documented. It is also the
 * only provider here that can offer genuine quality selection, because
 * Jellyfin transcodes on demand and its streaming endpoint accepts explicit
 * videoBitRate and width constraints.
 *
 * Note on resolution: Jellyfin treats width and bitrate as a ceiling rather
 * than an exact target - actual output also depends on the source file,
 * framerate and codec. So a tier is a request, not a guarantee, and the
 * labels reflect what was asked for.
 */

import { CAPABILITIES, QUALITY_TIERS } from './types';

const STORAGE_KEY = 'animiru.jellyfin.config';

const CLIENT = 'Animiru';
const CLIENT_VERSION = '1.0.0';

let config = loadConfig();

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    // Private-mode browsers can throw on access rather than returning null.
    return null;
  }
}

function persistConfig(next) {
  config = next;
  try {
    if (next) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch (err) {
    // Playback still works for this session even if persistence fails.
  }
}

/**
 * Reduces whatever the user pasted to a bare server origin.
 *
 * People copy the address out of their browser, which for Jellyfin looks like
 * http://host:8096/web/index.html#!/home.html. Appending an API path to that
 * yields a 404 that reads like the server is wrong when it is fine, so strip
 * the fragment, any /web UI path, and trailing slashes.
 *
 * A sub-path from a reverse proxy (http://host/jellyfin) is deliberately
 * preserved - that really is part of the API base.
 */
function normalizeServer(url) {
  let value = String(url || '').trim();
  if (!value) return '';

  // Drop the fragment first: everything after # is client-side routing.
  value = value.split('#')[0];

  // Drop the web UI entry point, with or without a filename.
  value = value.replace(/\/web\/?(index\.html)?\/?$/i, '');

  return value.replace(/\/+$/, '');
}

/**
 * A stable per-install id. Jellyfin uses it to track sessions, and a value
 * that changed every launch would litter the server's device list.
 */
function deviceId() {
  const key = 'animiru.deviceId';
  try {
    let existing = localStorage.getItem(key);
    if (!existing) {
      existing = `animiru-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      localStorage.setItem(key, existing);
    }
    return existing;
  } catch (err) {
    return 'animiru-ephemeral';
  }
}

function authHeader(token) {
  const parts = [
    `Client="${CLIENT}"`,
    `Device="Android"`,
    `DeviceId="${deviceId()}"`,
    `Version="${CLIENT_VERSION}"`
  ];
  if (token) parts.push(`Token="${token}"`);
  return `MediaBrowser ${parts.join(', ')}`;
}

async function request(path, { method = 'GET', body, server, token } = {}) {
  const base = normalizeServer(server || config?.server);
  const authToken = token || config?.token;

  if (!base) throw new Error('No Jellyfin server configured.');

  let response;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: authHeader(authToken)
      },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (err) {
    throw new Error(
      `Could not reach the Jellyfin server at ${base}. Check the address and that the server is running.`
    );
  }

  if (response.status === 401) {
    throw new Error('Jellyfin rejected the credentials. Sign in again.');
  }
  if (!response.ok) {
    throw new Error(`Jellyfin request failed (HTTP ${response.status}).`);
  }
  if (response.status === 204) return null;

  return response.json();
}

/** Signs in and stores the access token. */
export async function connect({ server, username, password }) {
  const base = normalizeServer(server);
  if (!base) throw new Error('Enter your Jellyfin server address.');

  const payload = await request('/Users/AuthenticateByName', {
    method: 'POST',
    server: base,
    body: { Username: username, Pw: password ?? '' }
  });

  if (!payload?.AccessToken || !payload?.User?.Id) {
    throw new Error('Jellyfin did not return an access token.');
  }

  persistConfig({
    server: base,
    token: payload.AccessToken,
    userId: payload.User.Id,
    username: payload.User.Name || username
  });

  return getConfig();
}

export function disconnect() {
  persistConfig(null);
}

/** Current connection details, without exposing the token to the UI. */
export function getConfig() {
  if (!config) return null;
  return {
    server: config.server,
    userId: config.userId,
    username: config.username
  };
}

export function isConfigured() {
  return Boolean(config?.server && config?.token && config?.userId);
}

function imageUrl(itemId, tag, type = 'Primary') {
  if (!tag) return undefined;
  const base = normalizeServer(config?.server);
  return `${base}/Items/${itemId}/Images/${type}?tag=${encodeURIComponent(tag)}&quality=90`;
}

function toCatalogItem(item) {
  return {
    id: item.Id,
    providerId: 'jellyfin',
    title: item.Name,
    poster: imageUrl(item.Id, item.ImageTags?.Primary),
    year: item.ProductionYear,
    kind: item.Type === 'Movie' ? 'movie' : 'series'
  };
}

/** Free-text search across series and movies. */
export async function search(query) {
  if (!isConfigured()) return [];

  const params = new URLSearchParams({
    userId: config.userId,
    searchTerm: query,
    IncludeItemTypes: 'Series,Movie',
    Recursive: 'true',
    Limit: '50',
    Fields: 'ProductionYear'
  });

  const payload = await request(`/Items?${params}`);
  return (payload?.Items || []).map(toCatalogItem);
}

/** Everything in the library, for browsing without a query. */
export async function getLibrary() {
  if (!isConfigured()) return [];

  const params = new URLSearchParams({
    userId: config.userId,
    IncludeItemTypes: 'Series,Movie',
    Recursive: 'true',
    SortBy: 'SortName',
    SortOrder: 'Ascending',
    Limit: '200',
    Fields: 'ProductionYear'
  });

  const payload = await request(`/Items?${params}`);
  return (payload?.Items || []).map(toCatalogItem);
}

export async function getItem(id) {
  const item = await request(`/Users/${config.userId}/Items/${id}`);
  return {
    ...toCatalogItem(item),
    overview: item.Overview,
    genres: item.Genres || []
  };
}

/** Episodes for a series. Movies have none, so this resolves to []. */
export async function getEpisodes(seriesId) {
  if (!isConfigured()) return [];

  const params = new URLSearchParams({ userId: config.userId });
  const payload = await request(`/Shows/${seriesId}/Episodes?${params}`);

  return (payload?.Items || []).map((ep) => ({
    id: ep.Id,
    providerId: 'jellyfin',
    title: ep.Name,
    number: ep.IndexNumber,
    season: ep.ParentIndexNumber,
    thumbnail: imageUrl(ep.Id, ep.ImageTags?.Primary)
  }));
}

/**
 * Builds the playable URLs for an item, one per quality tier.
 *
 * "Original" is a direct-play URL: no transcoding, so the server does no work
 * and quality is whatever the file already is. The remaining tiers ask the
 * transcoder for a width and bitrate ceiling.
 */
export async function getStreams(itemId) {
  if (!isConfigured()) {
    throw new Error('Connect a Jellyfin server first.');
  }

  const base = normalizeServer(config.server);
  const playSessionId = `${deviceId()}-${Date.now()}`;

  const options = [
    {
      label: 'Original',
      type: 'hls',
      url: `${base}/Videos/${itemId}/main.m3u8?${new URLSearchParams({
        api_key: config.token,
        mediaSourceId: itemId,
        playSessionId,
        videoCodec: 'h264',
        audioCodec: 'aac'
      })}`
    },
    ...QUALITY_TIERS.map((tier) => ({
      label: tier.label,
      height: tier.height,
      type: 'hls',
      url: `${base}/Videos/${itemId}/main.m3u8?${new URLSearchParams({
        api_key: config.token,
        mediaSourceId: itemId,
        playSessionId,
        videoCodec: 'h264',
        audioCodec: 'aac',
        maxWidth: String(tier.maxWidth),
        videoBitRate: String(tier.bitrate)
      })}`
    }))
  ];

  return { options };
}

const provider = {
  id: 'jellyfin',
  name: 'Jellyfin',
  capabilities: [
    CAPABILITIES.SEARCH,
    CAPABILITIES.LIBRARY,
    CAPABILITIES.PLAYBACK,
    CAPABILITIES.QUALITY_SELECTION
  ],
  isConfigured,
  search,
  getLibrary,
  getItem,
  getEpisodes,
  getStreams
};

export default provider;
