/**
 * Checking whether a newer build of the app exists.
 *
 * Releases are the source of truth, and GitHub's API allows cross-origin
 * reads, so the app asks it directly - no backend involved, and the check
 * still works when the backend is down, which is exactly when you might be
 * looking for an update.
 */

const RELEASES_API =
  'https://api.github.com/repos/perezfiles01-droid/animiru/releases/latest';

/** Stamped at build time by the workflow; unset in local development. */
export const CURRENT_VERSION = process.env.REACT_APP_VERSION || null;

const STARTUP_CHECK_KEY = 'animiru.updates.checkOnStartup';

/**
 * Compares two versions of the form v1.0.43.
 *
 * Numeric per part rather than lexicographic, because "v1.0.9" sorts after
 * "v1.0.43" as text and the app would then stop offering updates at 9.
 *
 * @returns {number} negative when a is older, 0 when equal, positive when newer
 */
export function compareVersions(a, b) {
  const parts = (value) => String(value || '')
    .replace(/^v/i, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);

  const left = parts(a);
  const right = parts(b);
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i += 1) {
    const difference = (left[i] || 0) - (right[i] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * Asks GitHub for the newest release.
 *
 * @returns {Promise<{version, name, notes, url, downloadUrl, publishedAt, isNewer, current}>}
 */
export async function checkForUpdate() {
  let response;
  try {
    response = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' }
    });
  } catch (err) {
    throw new Error('Could not reach GitHub to check for updates.');
  }

  if (response.status === 404) {
    throw new Error('No releases have been published yet.');
  }
  if (response.status === 403) {
    // Unauthenticated GitHub requests are rate limited per IP, and a shared
    // mobile network reaches that limit without the user doing anything odd.
    throw new Error('GitHub rate-limited the check. Try again in a few minutes.');
  }
  if (!response.ok) {
    throw new Error(`GitHub responded ${response.status}.`);
  }

  const release = await response.json();
  const asset = (release.assets || []).find((item) => item.name.endsWith('.apk'));

  return {
    version: release.tag_name,
    name: release.name || release.tag_name,
    notes: release.body || '',
    url: release.html_url,
    downloadUrl: asset ? asset.browser_download_url : null,
    publishedAt: release.published_at,
    current: CURRENT_VERSION,
    // Unknown current version means a development build; treat it as
    // up to date rather than nagging about an update it cannot apply.
    isNewer: Boolean(CURRENT_VERSION) && compareVersions(release.tag_name, CURRENT_VERSION) > 0
  };
}

export function getCheckOnStartup() {
  try {
    return window.localStorage.getItem(STARTUP_CHECK_KEY) !== 'false';
  } catch (err) {
    return true;
  }
}

export function setCheckOnStartup(enabled) {
  try {
    window.localStorage.setItem(STARTUP_CHECK_KEY, enabled ? 'true' : 'false');
  } catch (err) {
    // A store that refuses writes costs the preference, not the session.
  }
  return enabled;
}
