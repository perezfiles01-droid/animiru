/**
 * Install state is the one piece of the extension system that lives on the
 * device, so these tests pin both the behaviour and the failure mode - a
 * store that throws must not take the app down with it.
 */

import * as storage from '../storage';

function source(overrides = {}) {
  return {
    key: 'https://repo.test/index.json#42',
    id: '42',
    name: 'Example',
    repoUrl: 'https://repo.test/index.json',
    codeUrl: 'https://repo.test/example.js',
    version: '1.0.0',
    ...overrides
  };
}

describe('extension storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.restoreAllMocks();
  });

  describe('repositories', () => {
    it('starts empty', () => {
      expect(storage.getRepositories()).toEqual([]);
    });

    it('adds a repository and keeps insertion order', () => {
      storage.addRepository('https://a.test/index.json');
      storage.addRepository('https://b.test/index.json');
      expect(storage.getRepositories()).toEqual([
        'https://a.test/index.json',
        'https://b.test/index.json'
      ]);
    });

    it('ignores a repository that is already added', () => {
      storage.addRepository('https://a.test/index.json');
      storage.addRepository('https://a.test/index.json');
      expect(storage.getRepositories()).toHaveLength(1);
    });

    it('ignores an empty URL', () => {
      storage.addRepository('   ');
      expect(storage.getRepositories()).toEqual([]);
    });

    it('removes the sources installed from a repository it removes', () => {
      storage.addRepository('https://a.test/index.json');
      storage.installSource(source({ key: 'a#1', repoUrl: 'https://a.test/index.json' }));
      storage.installSource(source({ key: 'b#1', repoUrl: 'https://b.test/index.json' }));

      storage.removeRepository('https://a.test/index.json');

      expect(storage.getRepositories()).toEqual([]);
      expect(storage.getInstalledSources().map((s) => s.key)).toEqual(['b#1']);
    });
  });

  describe('sources', () => {
    it('installs a source as enabled', () => {
      storage.installSource(source());
      expect(storage.isInstalled(source().key)).toBe(true);
      expect(storage.getEnabledSources()).toHaveLength(1);
    });

    it('updates in place rather than installing twice on a version bump', () => {
      storage.installSource(source({ version: '1.0.0' }));
      storage.installSource(source({ version: '1.1.0' }));

      const installed = storage.getInstalledSources();
      expect(installed).toHaveLength(1);
      expect(installed[0].version).toBe('1.1.0');
    });

    it('keeps the original install time across an update', () => {
      storage.installSource(source());
      const first = storage.getInstalledSource(source().key).installedAt;
      storage.installSource(source({ version: '2.0.0' }));
      expect(storage.getInstalledSource(source().key).installedAt).toBe(first);
    });

    it('disables a source without uninstalling it', () => {
      storage.installSource(source());
      storage.setSourceEnabled(source().key, false);

      expect(storage.isInstalled(source().key)).toBe(true);
      expect(storage.getEnabledSources()).toHaveLength(0);
    });

    it('uninstalls a source and forgets its preferences', () => {
      storage.installSource(source());
      storage.setPreferences(source().key, { quality: '1080p' });

      storage.uninstallSource(source().key);

      expect(storage.getInstalledSources()).toEqual([]);
      expect(storage.getPreferences(source().key)).toEqual({});
    });

    it('ignores an entry with no key', () => {
      storage.installSource({ name: 'No key' });
      expect(storage.getInstalledSources()).toEqual([]);
    });
  });

  describe('preferences', () => {
    it('returns an empty object for a source with none set', () => {
      expect(storage.getPreferences('unknown')).toEqual({});
    });

    it('round-trips preferences per source', () => {
      storage.setPreferences('a', { quality: '720p' });
      storage.setPreferences('b', { quality: '1080p' });

      expect(storage.getPreferences('a')).toEqual({ quality: '720p' });
      expect(storage.getPreferences('b')).toEqual({ quality: '1080p' });
    });
  });

  describe('when the store is unavailable', () => {
    it('reads as empty rather than throwing', () => {
      jest.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });
      expect(storage.getRepositories()).toEqual([]);
      expect(storage.getInstalledSources()).toEqual([]);
      expect(storage.getPreferences('a')).toEqual({});
    });

    it('accepts a write that cannot persist rather than throwing', () => {
      jest.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
      expect(() => storage.addRepository('https://a.test/index.json')).not.toThrow();
      expect(() => storage.installSource(source())).not.toThrow();
    });

    it('reads as empty when the stored value is corrupt', () => {
      window.localStorage.setItem(storage.STORAGE_KEYS.REPOS_KEY, '{not json');
      window.localStorage.setItem(storage.STORAGE_KEYS.SOURCES_KEY, '"a string"');
      expect(storage.getRepositories()).toEqual([]);
      expect(storage.getInstalledSources()).toEqual([]);
    });
  });

  it('clears everything it owns', () => {
    storage.addRepository('https://a.test/index.json');
    storage.installSource(source());
    storage.setPreferences(source().key, { quality: '720p' });

    storage.clearAll();

    expect(storage.getRepositories()).toEqual([]);
    expect(storage.getInstalledSources()).toEqual([]);
    expect(storage.getPreferences(source().key)).toEqual({});
  });
});

/**
 * The home a source last worked from.
 *
 * Remembered per source so a source whose usual domain is down does not
 * pay the failed attempt on every screen. Nothing depends on it being
 * present or current - it is a shortcut, not state the app needs.
 */
describe('remembering which home worked', () => {
  const KEY = 'repo|Roaming';

  // This block sits outside the one whose beforeEach clears the store, so
  // it clears its own - otherwise a home remembered by one case is still
  // there for the next, and a test asserting nothing was remembered passes
  // or fails on what ran before it.
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('is nothing until something is remembered', () => {
    expect(storage.getSourceHome(KEY)).toBeNull();
  });

  it('gives back what was remembered', () => {
    storage.setSourceHome(KEY, 'https://one.test');
    expect(storage.getSourceHome(KEY)).toBe('https://one.test');
  });

  it('keeps each source separate', () => {
    storage.setSourceHome('a', 'https://a.test');
    storage.setSourceHome('b', 'https://b.test');

    expect(storage.getSourceHome('a')).toBe('https://a.test');
    expect(storage.getSourceHome('b')).toBe('https://b.test');
  });

  it('replaces the old one rather than collecting them', () => {
    storage.setSourceHome(KEY, 'https://one.test');
    storage.setSourceHome(KEY, 'https://two.test');

    expect(storage.getSourceHome(KEY)).toBe('https://two.test');
  });

  it.each([[''], [null], [undefined], [42]])('refuses to remember %p', (bad) => {
    storage.setSourceHome(KEY, bad);
    expect(storage.getSourceHome(KEY)).toBeNull();
  });

  it('can be forgotten', () => {
    storage.setSourceHome(KEY, 'https://one.test');
    storage.forgetSourceHome(KEY);

    expect(storage.getSourceHome(KEY)).toBeNull();
  });

  // A home left behind for a removed source would be inherited by a
  // reinstall, sending it to a mirror the user never chose.
  it('is forgotten when the source is uninstalled', () => {
    storage.installSource({ key: KEY, name: 'Roaming', codeUrl: 'https://repo.test/r.js' });
    storage.setSourceHome(KEY, 'https://one.test');

    storage.uninstallSource(KEY);

    expect(storage.getSourceHome(KEY)).toBeNull();
  });

  // "Clear all" that leaves something behind is not clear all.
  it('is cleared with everything else', () => {
    storage.setSourceHome(KEY, 'https://one.test');
    storage.clearAll();

    expect(storage.getSourceHome(KEY)).toBeNull();
  });
});
