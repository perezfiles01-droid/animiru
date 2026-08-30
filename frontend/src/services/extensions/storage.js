/**
 * Where the app remembers which repositories were added and which sources
 * are installed.
 *
 * This is per-device: nothing here reaches the server, so installing a
 * source on a phone does not install it on a desktop. That is a deliberate
 * choice - it needs no account and keeps no user content on our side - and
 * it is the reason every read and write goes through this one module. If it
 * should sync later, this file changes and nothing else does.
 */

const REPOS_KEY = 'animiru.extensions.repos';
const SOURCES_KEY = 'animiru.extensions.sources';
const PREFS_KEY = 'animiru.extensions.preferences';
const SELECTED_KEY = 'animiru.extensions.selected';
const SEARCH_SOURCES_KEY = 'animiru.searchSources';

/**
 * localStorage throws rather than returning null in a private window, in an
 * embedded webview with site data blocked, and during some previews - so
 * every access is guarded and the app carries on without a stored value.
 */
function read(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch (err) {
    return fallback;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    // A full or unavailable store is not worth interrupting the user over;
    // the change simply does not persist past this session.
    return false;
  }
}

/** @returns {string[]} repository index URLs, in the order they were added */
export function getRepositories() {
  const repos = read(REPOS_KEY, []);
  return Array.isArray(repos) ? repos.filter((url) => typeof url === 'string') : [];
}

export function addRepository(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed) return getRepositories();

  const repos = getRepositories();
  if (repos.includes(trimmed)) return repos;

  const next = [...repos, trimmed];
  write(REPOS_KEY, next);
  return next;
}

/**
 * Removes a repository and every source installed from it, so uninstalling
 * cannot leave rows behind that point at a repo the app no longer knows.
 */
export function removeRepository(url) {
  const next = getRepositories().filter((repo) => repo !== url);
  write(REPOS_KEY, next);

  const sources = getInstalledSources().filter((source) => source.repoUrl !== url);
  write(SOURCES_KEY, sources);

  return next;
}

/** @returns {Object[]} installed source entries, as returned by the API */
export function getInstalledSources() {
  const sources = read(SOURCES_KEY, []);
  if (!Array.isArray(sources)) return [];
  return sources.filter((source) => source && typeof source.key === 'string');
}

export function getInstalledSource(key) {
  return getInstalledSources().find((source) => source.key === key) || null;
}

export function isInstalled(key) {
  return getInstalledSources().some((source) => source.key === key);
}

/**
 * Installs a source, or updates it in place if it is already installed -
 * which is what makes a version bump replace the old entry rather than
 * appearing twice.
 */
export function installSource(source) {
  if (!source || typeof source.key !== 'string') return getInstalledSources();

  const entry = { ...source, enabled: source.enabled !== false, installedAt: Date.now() };
  const sources = getInstalledSources();
  const index = sources.findIndex((existing) => existing.key === entry.key);

  if (index === -1) {
    sources.push(entry);
  } else {
    sources[index] = { ...sources[index], ...entry, installedAt: sources[index].installedAt };
  }

  write(SOURCES_KEY, sources);
  return sources;
}

export function uninstallSource(key) {
  const sources = getInstalledSources().filter((source) => source.key !== key);
  write(SOURCES_KEY, sources);

  // Leaving a selection pointing at a source that is gone would open the app
  // on an empty screen with no obvious cause.
  if (read(SELECTED_KEY, null) === key) write(SELECTED_KEY, null);

  const prefs = readAllPreferences();
  if (prefs[key]) {
    delete prefs[key];
    write(PREFS_KEY, prefs);
  }

  return sources;
}

export function setSourceEnabled(key, enabled) {
  const sources = getInstalledSources().map((source) => (
    source.key === key ? { ...source, enabled: Boolean(enabled) } : source
  ));
  write(SOURCES_KEY, sources);
  return sources;
}

/** Installed sources the user has not switched off, in install order. */
export function getEnabledSources() {
  return getInstalledSources().filter((source) => source.enabled !== false);
}

function readAllPreferences() {
  const prefs = read(PREFS_KEY, {});
  return prefs && typeof prefs === 'object' && !Array.isArray(prefs) ? prefs : {};
}

/** @returns {Object} the user's settings for one source */
export function getPreferences(key) {
  const prefs = readAllPreferences()[key];
  return prefs && typeof prefs === 'object' ? prefs : {};
}

export function setPreferences(key, preferences) {
  const all = readAllPreferences();
  all[key] = preferences && typeof preferences === 'object' ? preferences : {};
  write(PREFS_KEY, all);
  return all[key];
}

/**
 * The source the user is currently browsing.
 *
 * Remembered so opening the app returns you to the source you were using,
 * rather than to whichever happens to be first in the install list.
 */
export function getSelectedSourceKey() {
  const key = read(SELECTED_KEY, null);
  return typeof key === 'string' ? key : null;
}

export function setSelectedSourceKey(key) {
  write(SELECTED_KEY, key);
  return key;
}

/**
 * Which sources a search asks.
 *
 * Empty means every installed source, which is the useful default: a search
 * names a title, so there is no reason to withhold it from a source that
 * might have it. Narrowing is the exception, so it is what gets stored.
 */
export function getSearchSourceKeys() {
  const keys = read(SEARCH_SOURCES_KEY, []);
  return Array.isArray(keys) ? keys.filter((key) => typeof key === 'string') : [];
}

export function setSearchSourceKeys(keys) {
  const clean = Array.isArray(keys) ? keys.filter((key) => typeof key === 'string') : [];
  write(SEARCH_SOURCES_KEY, clean);
  return clean;
}

/** Drops everything this module owns. Used by the settings "reset" action. */
export function clearAll() {
  write(REPOS_KEY, []);
  write(SOURCES_KEY, []);
  write(PREFS_KEY, {});
  write(SELECTED_KEY, null);
  write(SEARCH_SOURCES_KEY, []);
}

export const STORAGE_KEYS = {
  REPOS_KEY, SOURCES_KEY, PREFS_KEY, SELECTED_KEY, SEARCH_SOURCES_KEY
};
