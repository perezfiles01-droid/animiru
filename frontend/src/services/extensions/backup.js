/**
 * Exporting and restoring what the app keeps on this device.
 *
 * Installing a new APK over an old one keeps app storage - Android
 * guarantees that when the package name and signing key match, and this
 * app's repositories and installed sources live in that storage. So an
 * update does not lose anything.
 *
 * This exists for everything else: switching phones, clearing site data, a
 * sideload that lands with a different signature. It is a plain JSON file
 * the user holds, rather than a copy on a server we would then have to be
 * trusted with.
 */

import * as storage from './storage';

const FORMAT = 'animiru.backup';
const VERSION = 1;

/** @returns {string} the JSON a user saves */
export function exportSettings() {
  const sources = storage.getInstalledSources();
  const preferences = {};
  for (const source of sources) {
    const stored = storage.getPreferences(source.key);
    if (Object.keys(stored).length > 0) preferences[source.key] = stored;
  }

  return JSON.stringify({
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    repositories: storage.getRepositories(),
    sources,
    preferences
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

  return {
    repositories: storage.getRepositories().length,
    sources: storage.getInstalledSources().length
  };
}

export const BACKUP_FORMAT = FORMAT;
