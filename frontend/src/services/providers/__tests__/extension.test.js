/**
 * The shim is where Mangayomi's vocabulary becomes the app's, so these tests
 * are written against the shapes real sources actually return - including
 * the inconsistent ones.
 */

import {
  createExtensionProvider, parseEpisodeNumber, parseSeasonNumber,
  parseQualityHeight, parseServerLabel, isDubLabel
} from '../extension';
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

describe('parseServerLabel', () => {
  it.each([
    ['Vidstreaming - 1080p', 'Vidstreaming', '1080p'],
    ['Doodstream 720p', 'Doodstream', '720p'],
    ['1080p', 'Default', '1080p'],
    ['Server 2', 'Server 2', null],
    ['StreamSB | 480p', 'StreamSB', '480p'],
    ['Mp4Upload - HD', 'Mp4Upload', 'HD'],
    ['', 'Default', null]
  ])('splits %s into %s / %s', (label, server, quality) => {
    expect(parseServerLabel(label)).toEqual({ server, quality });
  });
});

describe('isDubLabel', () => {
  it.each([
    ['Server 1 - Dub', true],
    ['Vidstreaming Dubbed 1080p', true],
    ['Server 1 - Sub', false],
    ['1080p', false]
  ])('%s -> %s', (label, expected) => {
    expect(isDubLabel(label)).toBe(expected);
  });
});

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

    it('keeps every server, even when they share a label', async () => {
      // The bug this replaces: deduplicating on the label discarded every
      // mirror after the first, leaving one option and no way off a server
      // that would not play.
      resolves([
        { url: 'https://cdn.test/a.m3u8', quality: '1080p' },
        { url: 'https://cdn.test/b.m3u8', quality: '1080p' },
        { url: 'https://cdn.test/c.m3u8', quality: '1080p' }
      ]);

      const { options } = await provider.getStreams('/e/1');
      expect(options).toHaveLength(3);
    });

    it('drops the same URL twice, and entries with no URL at all', async () => {
      resolves([
        { url: 'https://cdn.test/a.m3u8', quality: '1080p' },
        { url: 'https://cdn.test/a.m3u8', quality: '720p' },
        { quality: '480p' }
      ]);

      const { options } = await provider.getStreams('/e/1');
      expect(options).toHaveLength(1);
    });

    it('separates the server name from the resolution', async () => {
      resolves([{ url: 'https://cdn.test/a.m3u8', quality: 'Vidstreaming - 1080p' }]);

      const [option] = (await provider.getStreams('/e/1')).options;
      expect(option).toMatchObject({
        server: 'Vidstreaming', quality: '1080p', label: 'Vidstreaming - 1080p'
      });
    });

    it('carries subtitles through, per server', async () => {
      resolves([{
        url: 'https://cdn.test/a.m3u8',
        quality: '1080p',
        subtitles: [
          { file: 'https://cdn.test/en.vtt', label: 'English' },
          { file: 'https://cdn.test/es.vtt', label: 'Spanish' }
        ]
      }]);

      const [option] = (await provider.getStreams('/e/1')).options;
      expect(option.subtitles).toEqual([
        { url: 'https://cdn.test/en.vtt', label: 'English', isEnglish: true },
        { url: 'https://cdn.test/es.vtt', label: 'Spanish', isEnglish: false }
      ]);
    });

    it('carries audio tracks through', async () => {
      resolves([{
        url: 'https://cdn.test/a.m3u8',
        quality: '1080p',
        audios: [{ file: 'https://cdn.test/en.m4a', label: 'English' }]
      }]);

      const [option] = (await provider.getStreams('/e/1')).options;
      expect(option.audios).toHaveLength(1);
      expect(option.audios[0].label).toBe('English');
    });

    it('leaves tracks as empty lists when a source offers none', async () => {
      resolves([{ url: 'https://cdn.test/a.m3u8', quality: '1080p' }]);

      const [option] = (await provider.getStreams('/e/1')).options;
      expect(option.subtitles).toEqual([]);
      expect(option.audios).toEqual([]);
    });

    it('marks an entry that names a dub', async () => {
      resolves([
        { url: 'https://cdn.test/sub.m3u8', quality: 'Server 1 - Sub - 1080p' },
        { url: 'https://cdn.test/dub.m3u8', quality: 'Server 1 - Dub - 1080p' }
      ]);

      const { options } = await provider.getStreams('/e/1');
      expect(options.map((o) => o.isDub)).toEqual([false, true]);
    });

    it('returns no options rather than throwing when a source finds nothing', async () => {
      resolves(null);
      expect(await provider.getStreams('/e/1')).toEqual({ options: [] });
    });
  });
});
