/**
 * The library: titles the user has saved.
 *
 * Stored locally rather than on a server. Animiru has no accounts - that
 * was deliberately removed - so there is nowhere else for this to live, and
 * a library that silently emptied itself on a new device would be worse
 * than one that is honestly per-device.
 *
 * An entry keeps the whole catalogue item rather than a reference to it. A
 * reference would mean asking the source for the title again to draw the
 * library, so an uninstalled or failing source would blank a shelf the user
 * had built. The poster and title are already known at the moment of
 * saving; keeping them means the library renders without the network.
 */

const LIBRARY_KEY = 'animiru.library';

/**
 * localStorage throws rather than returning null in a private window, in an
 * embedded webview with site data blocked, and when the quota is full - so
 * every access is guarded. A library that cannot be read is empty, not an
 * error the page has to handle.
 */
function read() {
  try {
    const raw = window.localStorage.getItem(LIBRARY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function write(entries) {
  try {
    window.localStorage.setItem(LIBRARY_KEY, JSON.stringify(entries));
  } catch (err) {
    // Nothing useful to do: the caller has already updated the screen, and
    // an alert about storage would be noise in front of a working page.
  }
  return entries;
}

/**
 * Identity is the source plus the source's own id.
 *
 * The same show from two sources is two entries, deliberately: they play
 * from different places and have different episode lists, so collapsing
 * them would make "watch" ambiguous.
 */
export function libraryKey(item) {
  if (!item) return '';
  return `${item.providerId || ''}:${item.id || ''}`;
}

/** Newest first: the last thing saved is the thing most likely wanted. */
export function getLibrary() {
  return read();
}

export function isInLibrary(item) {
  const key = libraryKey(item);
  return key !== ':' && read().some((entry) => libraryKey(entry) === key);
}

export function addToLibrary(item) {
  if (!item || !item.id || !item.providerId) return read();

  const key = libraryKey(item);
  const entries = read().filter((entry) => libraryKey(entry) !== key);

  return write([
    {
      id: item.id,
      providerId: item.providerId,
      providerName: item.providerName || '',
      title: item.title || 'Untitled',
      poster: item.poster || '',
      year: item.year,
      addedAt: Date.now()
    },
    ...entries
  ]);
}

export function removeFromLibrary(item) {
  const key = libraryKey(item);
  return write(read().filter((entry) => libraryKey(entry) !== key));
}

/** Returns whether the item is in the library after the toggle. */
export function toggleLibrary(item) {
  if (isInLibrary(item)) {
    removeFromLibrary(item);
    return false;
  }
  addToLibrary(item);
  return true;
}

export function clearLibrary() {
  return write([]);
}

export const LIBRARY_STORAGE_KEY = LIBRARY_KEY;
