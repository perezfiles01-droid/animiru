/**
 * The provider contract.
 *
 * The app is a host; sources are plugins. Nothing in the UI talks to a
 * specific service - it talks to this shape, so a new source is a new module
 * that satisfies the contract and nothing else changes.
 *
 * A provider implements some or all of:
 *
 *   id            string   stable identifier, e.g. "jellyfin"
 *   name          string   shown in the UI
 *   capabilities  object   see CAPABILITIES below
 *   isConfigured()          -> boolean
 *   search(query)           -> Promise<CatalogItem[]>
 *   getLibrary()            -> Promise<CatalogItem[]>
 *   getItem(id)             -> Promise<ItemDetail>
 *   getEpisodes(id)         -> Promise<Episode[]>
 *   getStreams(episode)     -> Promise<StreamSet>
 *
 * Shapes are deliberately provider-agnostic. A provider is responsible for
 * translating its own API into these, so the player never branches on which
 * source it came from.
 */

/**
 * @typedef {Object} CatalogItem
 * @property {string}  id          provider-scoped id
 * @property {string}  providerId
 * @property {string}  title
 * @property {string}  [poster]    absolute image URL
 * @property {number}  [year]
 * @property {string}  [kind]      "series" | "movie"
 */

/**
 * @typedef {Object} Episode
 * @property {string}  id
 * @property {string}  providerId
 * @property {string}  title
 * @property {number}  [number]
 * @property {number}  [season]
 * @property {string}  [thumbnail]
 */

/**
 * @typedef {Object} StreamOption
 * @property {string}  label     shown in the quality menu, e.g. "1080p"
 * @property {string}  url       playable URL
 * @property {string}  type      "hls" | "mp4" | "youtube"
 * @property {number}  [height]
 */

/**
 * @typedef {Object} StreamSet
 * @property {StreamOption[]} options  ordered best-first
 * @property {string}         [poster]
 */

export const CAPABILITIES = {
  /** Provider can be searched by free text. */
  SEARCH: 'search',
  /** Provider exposes a browsable library without a query. */
  LIBRARY: 'library',
  /** Provider returns multiple selectable quality tiers. */
  QUALITY_SELECTION: 'qualitySelection',
  /** Provider supplies playable video (as opposed to metadata only). */
  PLAYBACK: 'playback'
};

/**
 * Standard quality tiers.
 *
 * Providers that transcode (Jellyfin) map these onto real encoder
 * constraints. Providers that cannot honour them (YouTube, whose API no
 * longer allows programmatic quality control) must not advertise
 * QUALITY_SELECTION, so the UI does not render a control that does nothing.
 */
export const QUALITY_TIERS = [
  { label: '1080p', height: 1080, maxWidth: 1920, bitrate: 8000000 },
  { label: '720p', height: 720, maxWidth: 1280, bitrate: 4000000 },
  { label: '480p', height: 480, maxWidth: 854, bitrate: 1500000 },
  { label: '360p', height: 360, maxWidth: 640, bitrate: 800000 }
];
