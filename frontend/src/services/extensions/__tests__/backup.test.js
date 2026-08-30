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

    expect(restored).toEqual({ repositories: 1, sources: 1 });
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
