/**
 * Exporting and restoring what the app keeps on this device.
 *
 * Installing a new APK over an old one keeps app storage - Android
 * guarantees that when the package name and signing key match, and this
 * app's repositories and installed sources live in that storage. So an
 * update does not lose anything.
 *
 * That guarantee has not been holding: every CI build was signed with a
 * throwaway debug key, so no update would install over the last one and the
 * only way forward was uninstalling, which takes the storage with it.
 *
 * So this is not a corner case. It is the thing that carries a library,
 * sources and a tracker connection across a reinstall, a new phone, or
 * cleared site data. A plain JSON file the user holds, rather than a copy on
 * a server we would then have to be trusted with - which does mean the file
 * contains an AniList token if one is connected, and the screen says so.
 */

import * as storage from './storage';
import * as library from '../library';

const FORMAT = 'animiru.backup';
const VERSION = 2;

/**
 * Everything else the app keeps, by its storage key.
 *
 * Version 1 backed up repositories, sources and preferences only, which was
 * everything there was. Since then the app has grown a library, remembered
 * AniList matches and a tracker connection - all of it lost on the reinstall
 * a backup exists to survive. Listing the keys rather than copying the whole
 * of localStorage keeps unrelated junk, and anything a future version stores
 * that should not travel between devices, out of the file.
 */
const EXTRA_KEYS = [
  'animiru.library',
  'animiru.searchSources',
  'animiru.anilistMatches',
  'animiru.anilist.clientId',
  'animiru.anilist.token',
  'animiru.anilist.user',
  'animiru.anilist.autoSync'
];

function readRaw(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (err) {
    return null;
  }
}

function writeRaw(key, value) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch (err) { /* a private window: the restore applies to this visit */ }
}

/** @returns {string} the JSON a user saves */
export function exportSettings() {
  const sources = storage.getInstalledSources();
  const preferences = {};
  for (const source of sources) {
    const stored = storage.getPreferences(source.key);
    if (Object.keys(stored).length > 0) preferences[source.key] = stored;
  }

  // Stored as the raw strings localStorage holds, so a value this module
  // does not understand still survives a round trip intact.
  const other = {};
  for (const key of EXTRA_KEYS) {
    const raw = readRaw(key);
    if (raw !== null) other[key] = raw;
  }

  return JSON.stringify({
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    repositories: storage.getRepositories(),
    sources,
    preferences,
    other
  }, null, 2);
}

/**
 * Restores a backup, replacing what is on the device.
 *
 * Validated before anything is written: a half-applied restore would leave
 * the app in a state neither the file nor the device describes.
 *
 * @returns {{repositories: number, sources: number}} what was restored
 */
export function importSettings(json) {
  let backup;
  try {
    backup = JSON.parse(String(json));
  } catch (err) {
    throw new Error('That file is not valid JSON.');
  }

  if (!backup || backup.format !== FORMAT) {
    throw new Error('That is not an Animiru backup file.');
  }
  if (!Array.isArray(backup.repositories) || !Array.isArray(backup.sources)) {
    throw new Error('That backup is missing its repositories or sources.');
  }

  storage.clearAll();
  for (const key of EXTRA_KEYS) writeRaw(key, null);

  for (const url of backup.repositories) {
    if (typeof url === 'string') storage.addRepository(url);
  }
  for (const source of backup.sources) {
    if (source && typeof source.key === 'string') storage.installSource(source);
  }
  const preferences = backup.preferences || {};
  for (const key of Object.keys(preferences)) {
    storage.setPreferences(key, preferences[key]);
  }

  // Only keys this version knows. A backup naming something else is either
  // from a newer app or has been edited, and writing it unchecked would let
  // a file put arbitrary values into the app's storage.
  const other = backup.other || {};
  for (const key of EXTRA_KEYS) {
    if (typeof other[key] === 'string') writeRaw(key, other[key]);
  }

  return {
    repositories: storage.getRepositories().length,
    sources: storage.getInstalledSources().length,
    library: library.getLibrary().length
  };
}

export const BACKUP_FORMAT = FORMAT;
export const BACKUP_KEYS = EXTRA_KEYS;
