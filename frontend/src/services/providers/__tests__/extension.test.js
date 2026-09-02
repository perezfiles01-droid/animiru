/**
 * The shim is where Mangayomi's vocabulary becomes the app's, so these tests
 * are written against the shapes real sources actually return - including
 * the inconsistent ones.
 */

import {
  createExtensionProvider, parseEpisodeNumber, parseSeasonNumber,
  parseQualityHeight, parseServerLabel, isDubLabel, preferredSubtitleIndex
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
  // The first three are the exact shapes the sources users installed
  // produce. A parser that only handled "Server - 1080p" read the whole of
  // "[SUB - mega]" as the server name, which is why the Server control was
  // showing quality.
  it.each([
    ['1080p [SUB \u00b7 mega]', 'mega', '1080p', false],          // Miruro
    ['auto [DUB \u00b7 vidstream]', 'vidstream', 'AUTO', true],   // Miruro
    ['SUB [1080p]', null, '1080p', false],                    // Just4Anime
    ['DUB [auto]', null, 'AUTO', true],                       // Just4Anime
    ['1080p - Mega [Sub]', 'Mega', '1080p', false],           // AniKoto
    ['Srv [Sub]', 'Srv', null, false],                        // AniKoto
    ['Kiwi Stream [Dub]', 'Kiwi Stream', null, true],         // AniKoto
    ['Vidstreaming - 1080p', 'Vidstreaming', '1080p', false],
    ['Doodstream 720p', 'Doodstream', '720p', false],
    ['1080p', null, '1080p', false],
    ['Server 2', 'Server 2', null, false],
    ['StreamSB | 480p', 'StreamSB', '480p', false],
    ['Mp4Upload - HD', 'Mp4Upload', 'HD', false],
    ['', null, null, false]
  ])('reads %s as server %s, quality %s', (label, server, quality, isDub) => {
    expect(parseServerLabel(label)).toEqual({ server, quality, isDub });
  });

  it('spells one resolution one way, so the quality list does not repeat it', () => {
    expect(parseServerLabel('Mega 1080P').quality).toBe('1080p');
    expect(parseServerLabel('Mega [1080 p]').quality).toBe('1080p');
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

    /**
     * A source that ran cleanly and produced nothing used to reach the
     * player as a bare sentence - "This source found no video for that
     * episode" - with no trace behind it, because diagnostics were only
     * built for a thrown failure. Every report of it was therefore
     * unanswerable: nobody could tell a blocked request from a page whose
     * markup had moved.
     */
    describe('when a source returns no playable video', () => {
      const trace = (requests, result) => runSource.mockResolvedValueOnce({
        result, logs: [{ level: 'warn', message: 'no server' }], requests, durationMs: 9
      });

      const blocked = [
        { method: 'GET', url: 'https://site.test/e/1', status: 403, durationMs: 40 }
      ];

      it('fails rather than returning an empty option list', async () => {
        trace(blocked, []);
        await expect(provider.getStreams('/e/1')).rejects.toThrow(/found no video/);
      });

      it('carries the requests the source made, which is the actual evidence', async () => {
        trace(blocked, []);

        const err = await provider.getStreams('/e/1').catch((caught) => caught);
        expect(err.diagnostics.requests).toEqual(blocked);
        expect(err.diagnostics.failedRequests).toHaveLength(1);
      });

      it('names the source, so a report says which one', async () => {
        trace(blocked, []);

        const err = await provider.getStreams('/e/1').catch((caught) => caught);
        expect(err.diagnostics.source).toMatchObject({ name: 'Example', version: '1.0.0' });
        expect(err.diagnostics.method).toBe('getVideoList');
      });

      it('distinguishes servers without URLs from no servers at all', async () => {
        trace([], [{ quality: '1080p' }, { quality: '720p' }]);

        const err = await provider.getStreams('/e/1').catch((caught) => caught);
        expect(err.diagnostics.cause).toContain('2 servers');
        expect(err.diagnostics.cause).toContain('none of them carried a video URL');
      });

      it('says the source returned nothing when it returned nothing', async () => {
        trace([], []);

        const err = await provider.getStreams('/e/1').catch((caught) => caught);
        expect(err.diagnostics.cause).toContain('no servers at all');
      });

      it('keeps the console output the source produced', async () => {
        trace(blocked, []);

        const err = await provider.getStreams('/e/1').catch((caught) => caught);
        expect(err.diagnostics.logs).toEqual([{ level: 'warn', message: 'no server' }]);
      });

      // A source answering null is the same situation, and used to be
      // smoothed over into an empty list without comment.
      it('treats a null result the same way', async () => {
        trace(blocked, null);
        await expect(provider.getStreams('/e/1')).rejects.toThrow(/found no video/);
      });
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
        { url: 'https://cdn.test/en.vtt', content: undefined, label: 'English', isEnglish: true, isDefault: false },
        { url: 'https://cdn.test/es.vtt', content: undefined, label: 'Spanish', isEnglish: false, isDefault: false }
      ]);
    });

    // AniKoto downloads its own subtitles - the host refuses a request
    // without a Referer only the source knows - and returns the file itself
    // in the field a URL would use. Fetching that as a URL is what produced
    // "The subtitle host responded 404" for a track already in memory.
    it('keeps subtitle content a source returned inline', async () => {
      const srt = '1\n00:00:01,000 --> 00:00:02,000\nHello\n';
      resolves([{ url: 'https://cdn.test/a.m3u8', quality: '1080p',
        subtitles: [{ file: srt, label: 'English' }] }]);

      const [option] = (await provider.getStreams('/e/1')).options;
      expect(option.subtitles[0]).toMatchObject({ url: undefined, content: srt });
    });

    // Sources mark the track they mean to be shown; dropping it meant a
    // source that had already chosen English for the user was ignored.
    it('carries the track a source marked as default', async () => {
      resolves([{ url: 'https://cdn.test/a.m3u8', quality: '1080p',
        subtitles: [
          { file: 'https://cdn.test/es.vtt', label: 'Spanish' },
          { file: 'https://cdn.test/en.vtt', label: 'English', default: true }
        ] }]);

      const [option] = (await provider.getStreams('/e/1')).options;
      expect(option.subtitles.map((t) => t.isDefault)).toEqual([false, true]);
    });
  });

  describe('choosing which subtitle to show', () => {
    it('prefers the track the source marked', () => {
      expect(preferredSubtitleIndex([
        { label: 'English', isEnglish: true },
        { label: 'Spanish [forced]', isDefault: true }
      ])).toBe(1);
    });

    it('falls back to an English track', () => {
      expect(preferredSubtitleIndex([
        { label: 'Spanish' }, { label: 'English', isEnglish: true }
      ])).toBe(1);
    });

    it('shows something rather than nothing when no track is labelled', () => {
      expect(preferredSubtitleIndex([{ label: 'Track 1' }])).toBe(0);
    });

    it('reports that there is nothing to show', () => {
      expect(preferredSubtitleIndex([])).toBe(-1);
      expect(preferredSubtitleIndex(undefined)).toBe(-1);
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

    // This used to resolve with an empty list. It now fails, carrying the
    // trace - see 'when a source returns no playable video' above.
    it('fails when a source finds nothing at all', async () => {
      resolves(null);
      await expect(provider.getStreams('/e/1')).rejects.toThrow(/found no video/);
    });
  });
});

/**
 * Which of the source's homes the streams came from.
 *
 * A source may run on several domains. When every server one of them gave
 * fails to play, the screen has to be able to name that home as one to
 * skip - otherwise asking again goes back to it and returns the same
 * unplayable list.
 */
describe('the home a set of streams came from', () => {
  const oneStream = [{ url: 'https://cdn.test/a.m3u8', quality: '1080p' }];

  // This block sits outside the one that builds a provider, so it builds
  // its own and resets the mock itself.
  let provider;
  beforeEach(() => {
    runSource.mockReset();
    provider = createExtensionProvider(source);
  });

  it('is carried back with them', async () => {
    runSource.mockResolvedValueOnce({
      result: oneStream, baseUrl: 'https://one.test', logs: [], requests: [], durationMs: 1
    });

    const { home } = await provider.getStreams('/e/1');
    expect(home).toBe('https://one.test');
  });

  // A source with no mirrors reports none, and the screen simply has
  // nothing to rule out.
  it('is null when the run named none', async () => {
    resolves(oneStream);

    const { home } = await provider.getStreams('/e/1');
    expect(home).toBeNull();
  });

  it('passes the homes to skip through to the run', async () => {
    resolves(oneStream);

    await provider.getStreams('/e/1', { excludeBaseUrls: ['https://home.test'] });

    expect(runSource).toHaveBeenCalledWith(
      expect.objectContaining({ excludeBaseUrls: ['https://home.test'] })
    );
  });

  it('asks for none to be skipped when it is not told to', async () => {
    resolves(oneStream);

    await provider.getStreams('/e/1');

    expect(runSource).toHaveBeenCalledWith(
      expect.objectContaining({ excludeBaseUrls: undefined })
    );
  });
});
