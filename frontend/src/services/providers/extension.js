/**
 * A Mangayomi source, wearing the provider contract.
 *
 * Extensions speak Mangayomi's vocabulary - getPopular, getDetail,
 * getVideoList, chapters that are really episodes, quality as a free-text
 * label. The rest of the app speaks the contract in ./types.js and must not
 * learn otherwise. Everything in this file is that translation.
 *
 * A source that declares no catalogue of its own still answers search();
 * it simply has no front page to browse, so getLibrary() returns nothing
 * and the app does not offer it as somewhere to browse.
 */

import { CAPABILITIES } from './types';
import { runSource } from '../extensions/client';
import { getPreferences } from '../extensions/storage';
import { isInlineSubtitle } from '../subtitles';

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

/**
 * Splits a source's label into the server it names and the resolution.
 *
 * A Mangayomi entry carries one string for both - "Vidstreaming - 1080p",
 * "Doodstream 720p", "Server 2". Which server a stream came from is the part
 * that matters when one refuses to play, so it is pulled out rather than
 * shown as one opaque string.
 */
/** A whole segment that names a resolution rather than a server. */
const WHOLE_QUALITY = /^(\d{3,4}\s*p|4k|fhd|uhd|hd|sd|auto|default|original)$/i;

/** A resolution sitting inside a segment, as in "Doodstream 720p". */
const EMBEDDED_QUALITY = /\b(\d{3,4}\s*p|4K|FHD|UHD)\b/i;

/** A whole segment that names an audio track rather than a server. */
const WHOLE_AUDIO = /^(sub|dub|subbed|dubbed|softsub|hardsub|raw|multi)$/i;

/**
 * Splits a label into its segments.
 *
 * Sources build one string out of three things and each does it differently:
 *
 *     "1080p - Mega [Sub]"        AniKoto
 *     "SUB [1080p]"               Just4Anime
 *     "1080p [SUB · mega]"        Miruro
 *     "Vidstreaming - 1080p"      common
 *
 * Brackets and the separators between them are punctuation, not content, so
 * they are what the string is cut on. Spaces are not: a server is called
 * "Kiwi Stream" as readily as "mega".
 */
function segmentsOf(text) {
  return text
    .split(/[[\]()·•|,;/]|\s[-–—:]\s|\s{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * One spelling per resolution, so the Quality control does not offer
 * "1080P" and "1080 p" as two different things.
 */
function normaliseQuality(segment) {
  const text = segment.replace(/\s+/g, '');
  return /^\d/.test(text) ? text.toLowerCase() : text.toUpperCase();
}

export function parseServerLabel(label) {
  const text = String(label || '').trim();
  if (!text) return { server: null, quality: null, isDub: false };

  let quality = null;
  let isDub = false;
  const names = [];

  for (const segment of segmentsOf(text)) {
    if (WHOLE_QUALITY.test(segment)) {
      if (!quality) quality = normaliseQuality(segment);
      continue;
    }
    if (WHOLE_AUDIO.test(segment)) {
      if (/^dub/i.test(segment)) isDub = true;
      continue;
    }

    // A resolution can also sit inside a segment that names the server.
    // What is left of the segment is still the server's name.
    const embedded = segment.match(EMBEDDED_QUALITY);
    if (embedded) {
      if (!quality) quality = normaliseQuality(embedded[0]);
      const rest = segment.replace(embedded[0], '').replace(/[-–—|,:]+/g, ' ').trim();
      if (rest) names.push(rest);
      continue;
    }

    names.push(segment);
  }

  // A label may name no server at all - Just4Anime's is only "SUB [1080p]"
  // - in which case the caller says where the stream came from instead.
  return { server: names.length ? names.join(' ') : null, quality, isDub };
}

/** True when a label names an English dub rather than subtitles. */
export function isDubLabel(label) {
  return /\bdub(bed)?\b/i.test(String(label || ''));
}

/**
 * Normalises a Mangayomi track - `{file, label}` for a subtitle or an
 * audio - into something the player can use.
 */
function toTrack(track, index) {
  if (!track) return null;
  const value = track.file || track.url || track.src;
  if (!value) return null;

  // A source may hand over the subtitle itself rather than a link to it -
  // see services/subtitles.js. Fetching that as a URL is what produced
  // "The subtitle host responded 404" for a track already in memory.
  const inline = isInlineSubtitle(value);

  return {
    url: inline ? undefined : value,
    content: inline ? String(value) : undefined,
    label: track.label || track.lang || `Track ${index + 1}`,
    // A rough language guess from the label, for picking a sensible default.
    isEnglish: /\beng(lish)?\b/i.test(String(track.label || '')),
    // Sources mark the track they mean to be shown. Dropping this was why a
    // source that had chosen an English track for the user got ignored.
    isDefault: track.default === true || track.isDefault === true
  };
}

function toTracks(tracks) {
  if (!Array.isArray(tracks)) return [];
  return tracks.map(toTrack).filter(Boolean);
}

/**
 * Which subtitle track to show when playback starts.
 *
 * Subtitles are on by default, so this always names one if there are any:
 * what the source marked as default, else the first English track, else the
 * first track offered.
 *
 * @returns {number} an index into `tracks`, or -1 when there are none
 */
export function preferredSubtitleIndex(tracks) {
  if (!Array.isArray(tracks) || tracks.length === 0) return -1;

  const marked = tracks.findIndex((track) => track && track.isDefault);
  if (marked !== -1) return marked;

  const english = tracks.findIndex((track) => track && track.isEnglish);
  if (english !== -1) return english;

  return 0;
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

  /**
   * Every call into the source goes through here.
   *
   * Returns the whole run, not just its result: a run that succeeds still
   * carries the requests it made, and when a source returns nothing that
   * trace is the only evidence of why.
   */
  async function run(method, args, options = {}) {
    return runSource({
      codeUrl: source.codeUrl,
      version: source.version,
      method,
      args,
      source,
      preferences: getPreferences(source.key),
      // Homes already found wanting on this episode. Asking one of them
      // again returns the same streams that would not play.
      excludeBaseUrls: options.excludeBaseUrls
    });
  }

  async function call(method, args) {
    return (await run(method, args)).result;
  }

  /**
   * A source that ran cleanly and produced nothing.
   *
   * Not an exception as far as the sandbox is concerned, so nothing is
   * thrown and no diagnostics are built - which is exactly why "this source
   * found no video for that episode" was unanswerable. The trace is
   * assembled here in the shape a thrown failure would have had, so the same
   * report renders it.
   */
  function emptyResultError(message, { method, outcome, cause, fix }) {
    const error = new Error(message);
    const requests = (outcome && outcome.requests) || [];
    const logs = (outcome && outcome.logs) || [];

    error.logs = logs;
    error.requests = requests;
    error.diagnostics = {
      message,
      method,
      source: {
        name: source.name || null,
        version: source.version || null,
        repoUrl: source.repoUrl || null,
        codeUrl: source.codeUrl || null
      },
      cause,
      fix,
      location: null,
      excerpt: null,
      requests,
      failedRequests: requests.filter((request) => (
        request.error || (request.status && (request.status < 200 || request.status >= 300))
      )),
      logs
    };
    return error;
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
   * Every entry a source returns is one server, and several of them
   * routinely carry the same label - ten mirrors all called "1080p". They
   * are kept. An earlier version deduplicated on the label and so discarded
   * every alternative, which left one option in the menu and no way off a
   * server that would not play. Only an identical URL is dropped, since that
   * really is the same stream twice.
   *
   * Subtitles and audio tracks travel with each entry: they are per-server,
   * and one mirror having English subtitles says nothing about the next.
   */
  // Destructured rather than taken as an options object: this function
  // already builds a local named `options` - the list of streams it
  // returns - and a second one shadows it.
  async function getStreams(episode, { excludeBaseUrls } = {}) {
    const id = typeof episode === 'string' ? episode : episode.id;
    const outcome = await run('getVideoList', [id], { excludeBaseUrls });
    const videos = outcome.result || [];

    const seenUrls = new Set();
    const options = [];

    videos.forEach((video, index) => {
      const url = video.url || video.videoUrl || video.originalUrl;
      if (!url || seenUrls.has(url)) return;
      seenUrls.add(url);

      const label = video.quality || video.label || 'Default';
      const parsed = parseServerLabel(label);

      options.push({
        // What the source called it, kept whole for display.
        label,
        // A label may name no server - Just4Anime's is only "SUB [1080p]"
        // - so the extension it came from stands in. That keeps the Server
        // control meaningful when several extensions offer the same episode.
        server: parsed.server || source.name || source.key || 'Default',
        quality: parsed.quality,
        url,
        type: streamType(url),
        height: parseQualityHeight(label),
        // Many hosts reject a request without the referer the source used,
        // so the headers travel with the option.
        headers: video.headers || undefined,
        originalUrl: video.originalUrl || undefined,
        subtitles: toTracks(video.subtitles),
        audios: toTracks(video.audios),
        // The parser recognises "dub" as its own segment; isDubLabel still
        // catches it written into a server's name.
        isDub: parsed.isDub || isDubLabel(label),
        // Stable across re-ordering, so the player can remember a choice.
        id: `${index}:${parsed.server || ''}:${parsed.quality || ''}`
      });
    });

    // Best first by resolution, but a server's own order is otherwise kept:
    // sources list their most reliable mirror first, and that ordering is
    // worth more than any guess made here.
    options.sort((a, b) => {
      if (a.height && b.height) return b.height - a.height;
      if (a.height) return -1;
      if (b.height) return 1;
      return 0;
    });

    if (options.length === 0) {
      // Two different faults, and the trace tells them apart: a source that
      // returned entries carrying no playable URL is a parsing bug, while
      // one that returned nothing at all usually never got a usable page.
      const returnedEntries = Array.isArray(videos) && videos.length > 0;

      throw emptyResultError('This source found no video for that episode.', {
        method: 'getVideoList',
        outcome,
        cause: returnedEntries
          ? `The source listed ${videos.length} server${videos.length === 1 ? '' : 's'} `
            + 'for this episode but none of them carried a video URL.'
          : 'The source ran without failing and returned no servers at all for '
            + 'this episode.',
        fix: 'Check the requests below. A blocked or redirected request is the '
          + 'usual cause; if they all succeeded, the episode page changed shape '
          + 'and the source needs updating. Another source may have the episode.'
      });
    }

    // Which of the source's homes produced these. When none of them play,
    // the screen names it as one to skip and asks again - without it, the
    // next attempt would go back to the same home for the same streams.
    return { options, home: outcome.baseUrl || null };
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
    getStreams
  };
}

export default createExtensionProvider;
