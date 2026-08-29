/**
 * The shim is where Mangayomi's vocabulary becomes the app's, so these tests
 * are written against the shapes real sources actually return - including
 * the inconsistent ones.
 */

import { createExtensionProvider, parseEpisodeNumber, parseSeasonNumber, parseQualityHeight } from '../extension';
import { runSource } from '../../extensions/client';

jest.mock('../../extensions/client', () => ({ runSource: jest.fn() }));
jest.mock('../../extensions/storage', () => ({ getPreferences: () => ({ quality: '1080p' }) }));

const source = {
  key: 'https://repo.test/index.json#42',
  id: '42',
  name: 'Example',
  lang: 'en',
  codeUrl: 'https://repo.test/example.js',
  version: '1.0.0',
  isMetadataCapable: true
};

/** Makes the next call into the source resolve with `result`. */
function resolves(result) {
  runSource.mockResolvedValueOnce({ result, logs: [], requests: [], durationMs: 1 });
}

describe('parsing helpers', () => {
  it.each([
    ['Episode 12', 12],
    ['Ep. 7', 7],
    ['EP5', 5],
    ['12', 12],
    ['Episode 12.5', 12.5],
    ['Finale', undefined]
  ])('reads an episode number from %s', (title, expected) => {
    expect(parseEpisodeNumber(title)).toBe(expected);
  });

  it.each([['Season 2 Episode 1', 2], ['S3E4', 3], ['Episode 1', undefined]])(
    'reads a season number from %s',
    (title, expected) => {
      expect(parseSeasonNumber(title)).toBe(expected);
    }
  );

  it.each([['1080p', 1080], ['720 P', 720], ['FHD', undefined], ['Auto', undefined]])(
    'reads a height from %s only when the label carries one',
    (label, expected) => {
      expect(parseQualityHeight(label)).toBe(expected);
    }
  );
});

describe('extension provider', () => {
  let provider;

  beforeEach(() => {
    runSource.mockReset();
    provider = createExtensionProvider(source);
  });

  it('identifies itself by source key, so two repos can share a name', () => {
    expect(provider.id).toBe('extension:https://repo.test/index.json#42');
    expect(provider.name).toBe('Example');
  });

  it('passes the user preferences into every call', async () => {
    resolves({ list: [], hasNextPage: false });
    await provider.search('bleach');

    expect(runSource).toHaveBeenCalledWith(expect.objectContaining({
      codeUrl: source.codeUrl,
      version: '1.0.0',
      method: 'search',
      preferences: { quality: '1080p' }
    }));
  });

  describe('search and browse', () => {
    it('maps a source result list to catalogue items', async () => {
      resolves({
        list: [{ name: 'Bleach', imageUrl: 'https://img.test/b.jpg', link: '/anime/bleach' }],
        hasNextPage: true
      });

      expect(await provider.search('bleach')).toEqual([{
        id: '/anime/bleach',
        providerId: provider.id,
        title: 'Bleach',
        poster: 'https://img.test/b.jpg',
        kind: 'series'
      }]);
    });

    it('browses a metadata-capable source through getPopular', async () => {
      resolves({ list: [{ name: 'Popular', link: '/a' }] });
      const items = await provider.getLibrary();

      expect(runSource).toHaveBeenCalledWith(expect.objectContaining({ method: 'getPopular' }));
      expect(items).toHaveLength(1);
    });

    it('does not browse a source that carries no catalogue', async () => {
      const videoOnly = createExtensionProvider({ ...source, isMetadataCapable: false });
      expect(await videoOnly.getLibrary()).toEqual([]);
      expect(runSource).not.toHaveBeenCalled();
    });

    it('advertises library only for a metadata-capable source', () => {
      const videoOnly = createExtensionProvider({ ...source, isMetadataCapable: false });
      expect(provider.capabilities).toContain('library');
      expect(videoOnly.capabilities).not.toContain('library');
    });
  });

  describe('episodes', () => {
    it('accepts the episodes key', async () => {
      resolves({ name: 'Bleach', episodes: [{ name: 'Episode 1', url: '/e/1' }] });
      const episodes = await provider.getEpisodes('/anime/bleach');
      expect(episodes[0]).toMatchObject({ id: '/e/1', title: 'Episode 1', number: 1 });
    });

    it('accepts the chapters key older sources use', async () => {
      resolves({ name: 'Bleach', chapters: [{ name: 'Episode 1', url: '/e/1' }] });
      expect(await provider.getEpisodes('/anime/bleach')).toHaveLength(1);
    });

    it('reorders the newest-first list sources return', async () => {
      resolves({
        chapters: [
          { name: 'Episode 3', url: '/e/3' },
          { name: 'Episode 1', url: '/e/1' },
          { name: 'Episode 2', url: '/e/2' }
        ]
      });

      const episodes = await provider.getEpisodes('/anime/bleach');
      expect(episodes.map((ep) => ep.number)).toEqual([1, 2, 3]);
    });

    it('keeps unnumbered episodes rather than dropping them', async () => {
      resolves({
        chapters: [
          { name: 'Special', url: '/e/s' },
          { name: 'Episode 1', url: '/e/1' }
        ]
      });

      const episodes = await provider.getEpisodes('/anime/bleach');
      expect(episodes.map((ep) => ep.title)).toEqual(['Episode 1', 'Special']);
    });

    it('returns an empty list when a title has none', async () => {
      resolves({ name: 'Movie' });
      expect(await provider.getEpisodes('/anime/movie')).toEqual([]);
    });
  });

  describe('streams', () => {
    it('orders known heights best-first and types by URL', async () => {
      resolves([
        { url: 'https://cdn.test/720.m3u8', quality: '720p' },
        { url: 'https://cdn.test/1080.m3u8', quality: '1080p' },
        { url: 'https://cdn.test/auto.mp4', quality: 'Auto' }
      ]);

      const { options } = await provider.getStreams({ id: '/e/1' });

      expect(options.map((o) => o.label)).toEqual(['1080p', '720p', 'Auto']);
      expect(options[0]).toMatchObject({ type: 'hls', height: 1080 });
      expect(options[2]).toMatchObject({ type: 'mp4', height: undefined });
    });

    it('accepts an episode id string as well as an episode', async () => {
      resolves([{ url: 'https://cdn.test/a.mp4', quality: '480p' }]);
      const { options } = await provider.getStreams('/e/1');
      expect(options).toHaveLength(1);
    });

    it('carries the headers a video host requires', async () => {
      resolves([{
        url: 'https://cdn.test/a.m3u8',
        quality: '1080p',
        headers: { Referer: 'https://host.test/' }
      }]);

      const { options } = await provider.getStreams('/e/1');
      expect(options[0].headers).toEqual({ Referer: 'https://host.test/' });
    });

    it('drops duplicate labels and entries with no URL', async () => {
      resolves([
        { url: 'https://cdn.test/a.m3u8', quality: '1080p' },
        { url: 'https://cdn.test/b.m3u8', quality: '1080p' },
        { quality: '720p' }
      ]);

      const { options } = await provider.getStreams('/e/1');
      expect(options).toHaveLength(1);
    });

    it('returns no options rather than throwing when a source finds nothing', async () => {
      resolves(null);
      expect(await provider.getStreams('/e/1')).toEqual({ options: [] });
    });
  });

  describe('resolveByTitle', () => {
    it('picks a confident match and reports it as such', async () => {
      resolves({ list: [
        { name: 'Naruto Shippuden', link: '/a/1' },
        { name: 'Bleach', link: '/a/2' }
      ] });

      const match = await provider.resolveByTitle(['Bleach', 'BLEACH']);
      expect(match.best.id).toBe('/a/2');
      expect(match.confident).toBe(true);
    });

    it('reports a weak match rather than using it silently', async () => {
      resolves({ list: [{ name: 'Something Entirely Different', link: '/a/1' }] });

      const match = await provider.resolveByTitle(['Bleach']);
      expect(match.confident).toBe(false);
      expect(match.ranked).toHaveLength(1);
    });

    it('does not search when there is no title to search for', async () => {
      const match = await provider.resolveByTitle([]);
      expect(match).toEqual({ best: null, score: 0, confident: false, ranked: [] });
      expect(runSource).not.toHaveBeenCalled();
    });
  });
});
