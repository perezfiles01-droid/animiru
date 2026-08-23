/**
 * Resolves something legally watchable for a given anime.
 *
 * Background: this app has no video of its own. The previous Watch page
 * pointed at a placeholder URL (stream.example.com) that never existed, and
 * AniList is a metadata database - it serves no video either.
 *
 * The licensed distributors Muse Asia and Ani-One Asia publish full episodes
 * free on YouTube for Southeast Asia, India and the Middle East. Those embed
 * legally and play at up to 1080p using YouTube's own quality menu.
 *
 * Two resolution paths:
 *
 *   1. Full episodes  - requires a YouTube Data API key, searched against a
 *                       fixed allow-list of licensed channels.
 *   2. Trailer        - always available, no key, straight from AniList.
 *
 * Note on quality: YouTube removed programmatic quality control. Per the
 * IFrame API reference, setPlaybackQuality is now a no-op and
 * getAvailableQualityLevels is unsupported. Viewers pick quality from the
 * player's own gear menu, so this module does not pretend to offer a
 * quality API.
 */

const YOUTUBE_API = 'https://www.googleapis.com/youtube/v3/search';

/**
 * Channels that hold distribution licences for the anime they upload.
 *
 * Only add an entry whose channelId you have actually confirmed - an
 * unverified id silently returns nothing, or worse, matches an unlicensed
 * re-upload. Leave `channelId` null to render a search link instead of
 * including it in API queries.
 */
export const LICENSED_CHANNELS = [
  {
    name: 'Muse Asia',
    // Confirmed: youtube.com/channel/UCGbshtvS9t-8CW11W7TooQg
    channelId: 'UCGbshtvS9t-8CW11W7TooQg',
    regions: 'Southeast Asia, India, Middle East'
  },
  {
    name: 'Ani-One Asia',
    channelId: null, // not verified - search link only
    regions: 'Southeast Asia'
  },
  {
    name: 'Muse Philippines',
    channelId: null, // not verified - search link only
    regions: 'Philippines'
  }
];

const apiKey = process.env.REACT_APP_YOUTUBE_API_KEY || null;

/** True when full-episode search is configured. */
export function canSearchEpisodes() {
  return Boolean(apiKey);
}

/**
 * The YouTube embed URL for a video id.
 *
 * Uses youtube-nocookie.com, and a plain iframe rather than the JS IFrame
 * API: inside an Android WebView the API's origin handshake is a common
 * failure point, and the embed gives the same native player - including the
 * quality menu - without loading extra script.
 */
export function embedUrl(videoId) {
  const params = new URLSearchParams({
    rel: '0',           // keep related videos within the same channel
    modestbranding: '1',
    playsinline: '1'    // avoid iOS forcing its own fullscreen player
  });
  return `https://www.youtube-nocookie.com/embed/${videoId}?${params}`;
}

/** A YouTube search URL scoped to one licensed channel, for manual browsing. */
export function channelSearchUrl(channel, animeTitle) {
  const term = channel.channelId
    ? `${animeTitle}`
    : `${animeTitle} ${channel.name}`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(term)}`;
}

/**
 * Pulls a playable trailer id out of an AniList Media object.
 * Returns null when AniList has no trailer, or hosts it somewhere other
 * than YouTube (it also carries Dailymotion, which does not embed here).
 */
export function trailerVideoId(anime) {
  const trailer = anime?.trailer;
  if (!trailer || !trailer.id) return null;
  if (trailer.site && trailer.site.toLowerCase() !== 'youtube') return null;
  return trailer.id;
}

/**
 * Searches the licensed channels for episodes of `animeTitle`.
 * Resolves to [] when no API key is configured, so callers can treat "not
 * set up" and "nothing found" the same way.
 */
export async function findLicensedEpisodes(animeTitle, episodeNumber) {
  if (!apiKey) return [];

  const searchable = LICENSED_CHANNELS.filter((c) => c.channelId);
  if (searchable.length === 0) return [];

  const term = episodeNumber
    ? `${animeTitle} episode ${episodeNumber}`
    : animeTitle;

  const results = await Promise.all(
    searchable.map(async (channel) => {
      const params = new URLSearchParams({
        key: apiKey,
        part: 'snippet',
        type: 'video',
        maxResults: '5',
        videoEmbeddable: 'true',
        channelId: channel.channelId,
        q: term
      });

      let response;
      try {
        response = await fetch(`${YOUTUBE_API}?${params}`);
      } catch (err) {
        return []; // one channel failing must not sink the others
      }
      if (!response.ok) return [];

      const payload = await response.json();
      return (payload.items || []).map((item) => ({
        videoId: item.id.videoId,
        title: item.snippet.title,
        thumbnail: item.snippet.thumbnails?.medium?.url,
        channel: channel.name
      }));
    })
  );

  return results.flat();
}
