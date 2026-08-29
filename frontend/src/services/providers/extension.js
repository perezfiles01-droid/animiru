/**
 * A Mangayomi source, wearing the provider contract.
 *
 * Extensions speak Mangayomi's vocabulary - getPopular, getDetail,
 * getVideoList, chapters that are really episodes, quality as a free-text
 * label. The rest of the app speaks the contract in ./types.js and must not
 * learn otherwise. Everything in this file is that translation.
 *
 * Two kinds of source come through here:
 *
 *   - Metadata-capable ones carry their own catalogue and can be browsed
 *     directly, so they answer search() and getLibrary() themselves.
 *   - The rest only answer for a title we already know from AniList, so
 *     they are matched by name first. That guess is exposed rather than
 *     hidden - see resolveByTitle - because it is sometimes wrong.
 */

import { CAPABILITIES } from './types';
import { runSource } from '../extensions/client';
import { getPreferences } from '../extensions/storage';
import { rankCandidates } from './titleMatch';

/**
 * Pulls an episode or season number out of a title.
 *
 * Sources rarely return a numeric field; they return "Episode 12", "Ep. 12",
 * or just "12". Ordering the episode list correctly depends on getting this
 * right, so it is done here rather than left to the player.
 */
export function parseEpisodeNumber(title) {
  const text = String(title || '');
  const labelled = text.match(/(?:episode|ep\.?|e)\s*(\d+(?:\.\d+)?)/i);
  if (labelled) return Number(labelled[1]);

  const bare = text.match(/(\d+(?:\.\d+)?)/);
  return bare ? Number(bare[1]) : undefined;
}

export function parseSeasonNumber(title) {
  const match = String(title || '').match(/(?:season|s)\s*(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

/**
 * Reads a pixel height out of a source's quality label.
 *
 * Labels are free text - "1080p", "HD", "Auto", "FHD - Server 2". A number
 * is only reported when the label actually contains one; inventing a height
 * for "HD" would sort the list wrongly and lie in the quality menu.
 */
export function parseQualityHeight(label) {
  const match = String(label || '').match(/(\d{3,4})\s*p/i);
  return match ? Number(match[1]) : undefined;
}

/** HLS or a plain file, decided by the URL, since sources do not say. */
function streamType(url) {
  return /\.m3u8(\?|$)/i.test(String(url || '')) ? 'hls' : 'mp4';
}

function toCatalogItem(providerId, item) {
  return {
    // The source's own link is the only stable handle it has, and it is
    // what every later call needs, so it is the id.
    id: item.link || item.url || item.name,
    providerId,
    title: item.name || item.title || 'Untitled',
    poster: item.imageUrl || item.cover || undefined,
    kind: 'series'
  };
}

/**
 * Builds a provider for one installed source.
 *
 * @param {Object} source the installed entry from extension storage
 * @returns {Object} a provider satisfying ./types.js
 */
export function createExtensionProvider(source) {
  const providerId = `extension:${source.key}`;

  /** Every call into the source goes through here. */
  async function call(method, args) {
    const outcome = await runSource({
      codeUrl: source.codeUrl,
      version: source.version,
      method,
      args,
      source,
      preferences: getPreferences(source.key)
    });
    return outcome.result;
  }

  /** Mangayomi's paged list shape, in either of the two spellings sources use. */
  function toCatalogList(result) {
    const list = (result && (result.list || result.items)) || [];
    return list.map((item) => toCatalogItem(providerId, item));
  }

  async function search(query, page = 1) {
    return toCatalogList(await call('search', [query, page, []]));
  }

  /**
   * The source's own front page. Only meaningful for a metadata-capable
   * source; the others have nothing to browse.
   */
  async function getLibrary(page = 1) {
    if (!source.isMetadataCapable) return [];
    return toCatalogList(await call('getPopular', [page]));
  }

  async function getDetail(id) {
    return call('getDetail', [id]);
  }

  async function getItem(id) {
    const detail = await getDetail(id);
    return {
      id,
      providerId,
      title: detail.name || 'Untitled',
      poster: detail.imageUrl || undefined,
      kind: 'series',
      overview: detail.description || '',
      genres: detail.genre || detail.genres || [],
      status: detail.status
    };
  }

  /**
   * Episodes for a title.
   *
   * Sources spell the list `episodes` or `chapters` depending on which
   * Mangayomi era they were written in, and they return newest-first.
   * Both are normalised here so the player never has to care.
   */
  async function getEpisodes(id) {
    const detail = await getDetail(id);
    const raw = detail.episodes || detail.chapters || [];

    const episodes = raw.map((episode) => ({
      id: episode.url || episode.link,
      providerId,
      title: episode.name || episode.title || 'Episode',
      number: parseEpisodeNumber(episode.name || episode.title),
      season: parseSeasonNumber(episode.name || episode.title),
      thumbnail: episode.imageUrl || undefined
    }));

    // Ascending by number, with unnumbered entries kept in source order at
    // the end rather than being dropped or sorted arbitrarily.
    const numbered = episodes.filter((ep) => Number.isFinite(ep.number));
    const unnumbered = episodes.filter((ep) => !Number.isFinite(ep.number));
    numbered.sort((a, b) => a.number - b.number);

    return [...numbered, ...unnumbered];
  }

  /**
   * Playable URLs for one episode.
   *
   * A Mangayomi source returns a flat list where each entry is one server at
   * one quality, so the list is deduplicated by label and ordered
   * best-first: known heights descending, then the labels that carry no
   * number, which are usually "Auto" or a named mirror.
   */
  async function getStreams(episode) {
    const id = typeof episode === 'string' ? episode : episode.id;
    const videos = (await call('getVideoList', [id])) || [];

    const seen = new Set();
    const options = [];

    for (const video of videos) {
      const url = video.url || video.videoUrl || video.originalUrl;
      if (!url) continue;

      const label = video.quality || video.label || 'Default';
      if (seen.has(label)) continue;
      seen.add(label);

      options.push({
        label,
        url,
        type: streamType(url),
        height: parseQualityHeight(label),
        // Many hosts reject a request without the referer the source used,
        // so the headers travel with the option for the player to apply.
        headers: video.headers || undefined
      });
    }

    options.sort((a, b) => {
      if (a.height && b.height) return b.height - a.height;
      if (a.height) return -1;
      if (b.height) return 1;
      return 0;
    });

    return { options };
  }

  /**
   * Finds this source's entry for a show AniList told us about.
   *
   * Returns the ranked candidates alongside the pick, so the UI can show
   * what was chosen and let the user correct it. Nothing here decides
   * silently on the user's behalf.
   *
   * @param {string[]} titles the names AniList has for the show
   */
  async function resolveByTitle(titles) {
    const names = (Array.isArray(titles) ? titles : [titles]).filter(Boolean);
    if (names.length === 0) return { best: null, score: 0, confident: false, ranked: [] };

    // The first title is the one most likely to be indexed by a scraper.
    const candidates = await search(names[0], 1);
    return rankCandidates(names, candidates);
  }

  const capabilities = [CAPABILITIES.SEARCH, CAPABILITIES.PLAYBACK];
  if (source.isMetadataCapable) capabilities.push(CAPABILITIES.LIBRARY);
  // Whether a given episode really offers tiers is only known once
  // getVideoList has answered, so the returned option list stays
  // authoritative and the UI hides the control when it holds one entry.
  capabilities.push(CAPABILITIES.QUALITY_SELECTION);

  return {
    id: providerId,
    name: source.name,
    lang: source.lang,
    iconUrl: source.iconUrl,
    isNsfw: source.isNsfw,
    isMetadataCapable: Boolean(source.isMetadataCapable),
    sourceKey: source.key,
    capabilities,
    isConfigured: () => true,
    search,
    getLibrary,
    getItem,
    getEpisodes,
    getStreams,
    resolveByTitle
  };
}

export default createExtensionProvider;
