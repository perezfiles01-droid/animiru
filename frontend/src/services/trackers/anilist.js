/**
 * AniList as a tracking service.
 *
 * The token is obtained by the implicit grant and kept on the device. That
 * choice is deliberate: the alternative, an authorization-code exchange,
 * needs a client secret, which would have to live on our server, and would
 * mean every user's AniList token passing through it. Implicit needs only a
 * client id, which is not a secret, and the token never leaves the device -
 * the app talks to AniList directly, which its API allows from a browser.
 *
 * The client id is the user's own, from anilist.co/settings/developer. There
 * is no Animiru-wide application to register against, and one would make
 * every user's tracking depend on a registration only I could maintain.
 */

const CLIENT_ID_KEY = 'animiru.anilist.clientId';
const TOKEN_KEY = 'animiru.anilist.token';
const USER_KEY = 'animiru.anilist.user';
const AUTOSYNC_KEY = 'animiru.anilist.autoSync';

const ENDPOINT = 'https://graphql.anilist.co';

function read(key, fallback = null) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (err) { /* a private window; the setting applies to this visit */ }
  return value;
}

function drop(key) {
  try {
    window.localStorage.removeItem(key);
  } catch (err) { /* as above */ }
}

export const getClientId = () => read(CLIENT_ID_KEY, '') || '';
export const setClientId = (id) => write(CLIENT_ID_KEY, String(id || '').trim());

export const getToken = () => read(TOKEN_KEY, '') || '';
export const getUser = () => read(USER_KEY, null);

export const isConnected = () => Boolean(getToken());

/** On by default once connected: tracking that never syncs is decoration. */
export const isAutoSyncEnabled = () => read(AUTOSYNC_KEY, true) !== false;
export const setAutoSyncEnabled = (on) => write(AUTOSYNC_KEY, Boolean(on));

/**
 * The redirect AniList sends the user back to.
 *
 * AniList's own PIN page, not a page of ours, and that is the whole trick.
 * In the Android app the UI is served from a virtual origin inside the
 * WebView (appassets.androidplatform.net), which does not exist anywhere
 * else - and the authorize page opens in the real browser, because the
 * shell sends external links there. A redirect back to our own address
 * would therefore fail in the browser with the token stranded in its
 * address bar. AniList's PIN page shows the token instead, for the user to
 * copy back into the app, which works from any browser on any device.
 */
export const REDIRECT_URL = 'https://anilist.co/api/v2/oauth/pin';

/**
 * Where the user is sent to approve access.
 *
 * response_type=token is the implicit grant: AniList hands back a token
 * directly, with no secret to exchange and nothing passing through our
 * server.
 */
export function authorizeUrl(clientId = getClientId()) {
  const id = encodeURIComponent(String(clientId || '').trim());
  return `https://anilist.co/api/v2/oauth/authorize?client_id=${id}&response_type=token`;
}

/** Reads the token AniList put in the fragment when it sent the user back. */
export function tokenFromFragment(fragment) {
  const text = String(fragment || '').replace(/^#/, '');
  if (!text) return null;

  const found = new URLSearchParams(text).get('access_token');
  return found || null;
}

async function query(document, variables) {
  const token = getToken();
  if (!token) throw new Error('Not connected to AniList');

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ query: document, variables })
  });

  // An expired or revoked token is the one failure worth naming: the remedy
  // is to reconnect, and "request failed" would not say so.
  if (response.status === 401 || response.status === 400) {
    throw new Error('AniList rejected the token. Connect again in Settings.');
  }

  const payload = await response.json().catch(() => null);

  if (!payload) throw new Error('AniList returned something that is not JSON');

  // GraphQL reports errors with a 200, so the status alone proves nothing.
  if (payload.errors && payload.errors.length) {
    throw new Error(payload.errors[0].message || 'AniList rejected the request');
  }

  return payload.data || {};
}

/** Confirms the token works and remembers who it belongs to. */
export async function connect(token) {
  write(TOKEN_KEY, String(token || '').trim());

  try {
    const data = await query('query { Viewer { id name avatar { medium } } }');
    const viewer = data.Viewer;

    if (!viewer) throw new Error('AniList did not say who the token belongs to');

    return write(USER_KEY, {
      id: viewer.id,
      name: viewer.name,
      avatar: (viewer.avatar && viewer.avatar.medium) || ''
    });
  } catch (err) {
    // A token that cannot identify anyone is not a connection, and leaving
    // it stored would make the screen claim otherwise.
    disconnect();
    throw err;
  }
}

export function disconnect() {
  drop(TOKEN_KEY);
  drop(USER_KEY);
}

/**
 * Records progress against a title on the user's list.
 *
 * Never lowers it. Rewatching an early episode, or opening one out of
 * order, would otherwise undo progress the user actually made - and a
 * tracker that loses your place is worse than no tracker.
 */
export async function setProgress(mediaId, episodeNumber) {
  const progress = Number(episodeNumber);
  if (!Number.isFinite(progress) || progress <= 0) return null;

  const current = await query(`
    query ($mediaId: Int) {
      Media(id: $mediaId) { mediaListEntry { progress status } }
    }
  `, { mediaId: Number(mediaId) });

  const entry = (current.Media && current.Media.mediaListEntry) || null;
  if (entry && Number(entry.progress) >= progress) {
    return { progress: Number(entry.progress), unchanged: true };
  }

  const data = await query(`
    mutation ($mediaId: Int, $progress: Int) {
      SaveMediaListEntry(mediaId: $mediaId, progress: $progress, status: CURRENT) {
        id
        progress
        status
      }
    }
  `, { mediaId: Number(mediaId), progress });

  return data.SaveMediaListEntry || null;
}

export const STORAGE_KEYS = { CLIENT_ID_KEY, TOKEN_KEY, USER_KEY, AUTOSYNC_KEY };
