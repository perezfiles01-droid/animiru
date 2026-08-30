/**
 * Export and restore.
 *
 * An update keeps app storage on its own; this covers the cases that do not
 * - a new phone, cleared data, a differently-signed build.
 */

import { exportSettings, importSettings } from '../backup';
import * as storage from '../storage';

function source(overrides = {}) {
  return {
    key: 'https://repo.test/index.json#42',
    id: '42',
    name: 'Example',
    lang: 'en',
    version: '1.0.0',
    repoUrl: 'https://repo.test/index.json',
    codeUrl: 'https://repo.test/example.js',
    ...overrides
  };
}

describe('backup', () => {
  beforeEach(() => window.localStorage.clear());

  it('round-trips repositories, sources and preferences', () => {
    storage.addRepository('https://repo.test/index.json');
    storage.installSource(source());
    storage.setPreferences(source().key, { quality: '1080p' });

    const json = exportSettings();
    storage.clearAll();
    expect(storage.getInstalledSources()).toEqual([]);

    const restored = importSettings(json);

    expect(restored).toEqual({ repositories: 1, sources: 1, library: 0 });
    expect(storage.getRepositories()).toEqual(['https://repo.test/index.json']);
    expect(storage.getInstalledSource(source().key)).toMatchObject({ name: 'Example' });
    expect(storage.getPreferences(source().key)).toEqual({ quality: '1080p' });
  });

  it('exports an empty device without complaint', () => {
    const parsed = JSON.parse(exportSettings());
    expect(parsed).toMatchObject({ repositories: [], sources: [] });
  });

  it('replaces what is there rather than merging into it', () => {
    storage.addRepository('https://old.test/index.json');
    storage.installSource(source({ key: 'old', name: 'Old' }));

    const json = JSON.stringify({
      format: 'animiru.backup',
      version: 1,
      repositories: ['https://new.test/index.json'],
      sources: [source({ key: 'new', name: 'New' })]
    });
    importSettings(json);

    expect(storage.getRepositories()).toEqual(['https://new.test/index.json']);
    expect(storage.getInstalledSources().map((s) => s.name)).toEqual(['New']);
  });

  it('refuses a file that is not JSON', () => {
    expect(() => importSettings('not json')).toThrow(/not valid JSON/);
  });

  it('refuses JSON that is not one of ours', () => {
    expect(() => importSettings('{"hello":"world"}')).toThrow(/not an Animiru backup/);
  });

  it('refuses a backup missing its arrays, before writing anything', () => {
    storage.installSource(source());

    expect(() => importSettings('{"format":"animiru.backup","version":1}'))
      .toThrow(/missing its repositories or sources/);
    // Validation happens first, so the device is untouched.
    expect(storage.getInstalledSources()).toHaveLength(1);
  });

  it('skips entries that are the wrong shape rather than storing rubbish', () => {
    importSettings(JSON.stringify({
      format: 'animiru.backup',
      version: 1,
      repositories: ['https://ok.test/i.json', 42, null],
      sources: [source(), { name: 'no key' }, null]
    }));

    expect(storage.getRepositories()).toEqual(['https://ok.test/i.json']);
    expect(storage.getInstalledSources()).toHaveLength(1);
  });
});

/**
 * Version 1 carried repositories, sources and preferences, which was all
 * there was. The app has since grown a library, remembered AniList matches
 * and a tracker connection - all of it lost on exactly the reinstall a
 * backup exists to survive.
 */
describe('everything else the app keeps', () => {
  const { BACKUP_KEYS } = require('../backup');
  const library = require('../../library');

  beforeEach(() => window.localStorage.clear());

  const saved = () => ({
    id: '/anime/frieren', providerId: 'extension:a',
    providerName: 'AniNeko', title: 'Frieren', poster: 'https://i.test/f.jpg'
  });

  it('carries the library across a restore', () => {
    library.addToLibrary(saved());

    const json = exportSettings();
    window.localStorage.clear();
    const counts = importSettings(json);

    expect(library.getLibrary()).toHaveLength(1);
    expect(library.getLibrary()[0].title).toBe('Frieren');
    expect(counts.library).toBe(1);
  });

  it('carries the AniList connection, so a restore need not reconnect', () => {
    window.localStorage.setItem('animiru.anilist.token', '"tok"');
    window.localStorage.setItem('animiru.anilist.clientId', '"49814"');

    const json = exportSettings();
    window.localStorage.clear();
    importSettings(json);

    expect(window.localStorage.getItem('animiru.anilist.token')).toBe('"tok"');
    expect(window.localStorage.getItem('animiru.anilist.clientId')).toBe('"49814"');
  });

  it('carries a corrected AniList match, so it need not be corrected again', () => {
    window.localStorage.setItem('animiru.anilistMatches', '{"extension:a:/x":42}');

    const json = exportSettings();
    window.localStorage.clear();
    importSettings(json);

    expect(window.localStorage.getItem('animiru.anilistMatches'))
      .toBe('{"extension:a:/x":42}');
  });

  // Writing whatever a file names would let an edited backup put arbitrary
  // values into the app's storage.
  it('ignores a key it does not know', () => {
    const json = JSON.parse(exportSettings());
    json.other = { ...json.other, 'evil.key': '"payload"' };

    importSettings(JSON.stringify(json));

    expect(window.localStorage.getItem('evil.key')).toBeNull();
  });

  it('clears what was there before, rather than merging', () => {
    const json = exportSettings();
    library.addToLibrary(saved());

    importSettings(json);

    expect(library.getLibrary()).toEqual([]);
  });

  // A round trip through the raw stored string means a value this module
  // does not interpret still survives intact.
  it('keeps every key it claims to keep', () => {
    for (const key of BACKUP_KEYS) window.localStorage.setItem(key, `"v-${key}"`);

    const json = exportSettings();
    window.localStorage.clear();
    importSettings(json);

    for (const key of BACKUP_KEYS) {
      expect(window.localStorage.getItem(key)).toBe(`"v-${key}"`);
    }
  });

  it('still restores a version 1 backup, which has no other section', () => {
    const old = JSON.stringify({
      format: 'animiru.backup', version: 1,
      repositories: ['https://r.test/index.json'], sources: [], preferences: {}
    });

    expect(() => importSettings(old)).not.toThrow();
    expect(importSettings(old).library).toBe(0);
  });
});
