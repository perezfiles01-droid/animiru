const assert = require("assert");

const {
  sourceString,
  sourceIsUrl,
  sourceAbsoluteUrl,
  sourceUniqueItems,
  sourceValidateAnimeItem,
  sourceValidateAnimeList,
  sourceValidateEpisode,
  sourceValidateEpisodes,
  sourceValidateDetail,
  sourceValidateVideo,
  sourceValidateVideos,
  sourceEmptyDiagnostics,
  sourcePage
} = require("./source-helper");

const BASE_URL = "https://example.com";

/* -------------------------------------------------------------------------- */
/* Basic helpers                                                              */
/* -------------------------------------------------------------------------- */

assert.strictEqual(
  sourceString("  Hello  "),
  "Hello"
);

assert.strictEqual(
  sourceString(null, "fallback"),
  "fallback"
);

assert.strictEqual(
  sourceIsUrl("https://example.com/test"),
  true
);

assert.strictEqual(
  sourceIsUrl("not-a-url"),
  false
);

assert.strictEqual(
  sourceAbsoluteUrl(BASE_URL, "/anime/test"),
  "https://example.com/anime/test"
);

assert.strictEqual(
  sourceAbsoluteUrl(BASE_URL, "anime/test"),
  "https://example.com/anime/test"
);

/* -------------------------------------------------------------------------- */
/* Duplicate results                                                         */
/* -------------------------------------------------------------------------- */

var duplicates = sourceUniqueItems([
  {
    name: "One Piece",
    link: "https://example.com/one-piece"
  },
  {
    name: "One Piece",
    link: "https://example.com/one-piece"
  },
  {
    name: "Naruto",
    link: "https://example.com/naruto"
  }
]);

assert.strictEqual(
  duplicates.length,
  2
);

/* -------------------------------------------------------------------------- */
/* Anime item validation                                                      */
/* -------------------------------------------------------------------------- */

var validAnime = sourceValidateAnimeItem(
  {
    name: "One Piece",
    link: "/anime/one-piece",
    imageUrl: "/images/one-piece.jpg"
  },
  BASE_URL
);

assert.strictEqual(
  validAnime.valid,
  true
);

assert.strictEqual(
  validAnime.item.name,
  "One Piece"
);

assert.strictEqual(
  validAnime.item.link,
  "https://example.com/anime/one-piece"
);

var missingAnimeName = sourceValidateAnimeItem(
  {
    link: "/anime/test"
  },
  BASE_URL
);

assert.strictEqual(
  missingAnimeName.valid,
  false
);

var invalidAnimeLink = sourceValidateAnimeItem(
  {
    name: "Test",
    link: "not-a-url"
  },
  BASE_URL
);

assert.strictEqual(
  invalidAnimeLink.valid,
  false
);

/* -------------------------------------------------------------------------- */
/* Anime list validation                                                      */
/* -------------------------------------------------------------------------- */

var animeList = sourceValidateAnimeList(
  [
    {
      name: "One Piece",
      link: "/anime/one-piece"
    },
    {
      name: "Naruto",
      link: "/anime/naruto"
    },
    {
      name: "One Piece",
      link: "/anime/one-piece"
    }
  ],
  BASE_URL
);

assert.strictEqual(
  animeList.list.length,
  2
);

assert.strictEqual(
  animeList.list[0].name,
  "One Piece"
);

/* -------------------------------------------------------------------------- */
/* Episode validation                                                         */
/* -------------------------------------------------------------------------- */

var episode = sourceValidateEpisode(
  {
    name: "Episode 1",
    url: "/watch/test/1",
    isFiller: false
  },
  BASE_URL
);

assert.strictEqual(
  episode.valid,
  true
);

assert.strictEqual(
  episode.item.name,
  "Episode 1"
);

assert.strictEqual(
  episode.item.url,
  "https://example.com/watch/test/1"
);

var invalidEpisode = sourceValidateEpisode(
  {
    name: "Episode 1",
    url: "invalid"
  },
  BASE_URL
);

assert.strictEqual(
  invalidEpisode.valid,
  false
);

var episodes = sourceValidateEpisodes(
  [
    {
      name: "Episode 1",
      url: "/watch/test/1"
    },
    {
      name: "Episode 2",
      url: "/watch/test/2"
    },
    {
      name: "Episode 2",
      url: "/watch/test/2"
    }
  ],
  BASE_URL
);

assert.strictEqual(
  episodes.chapters.length,
  2
);

/* -------------------------------------------------------------------------- */
/* Detail validation                                                          */
/* -------------------------------------------------------------------------- */

var validDetail = sourceValidateDetail(
  {
    name: "One Piece",
    link: "https://example.com/anime/one-piece",
    genre: ["Action", "Adventure"],
    chapters: [
      {
        name: "Episode 1",
        url: "https://example.com/watch/1"
      }
    ]
  },
  BASE_URL
);

assert.strictEqual(
  validDetail.valid,
  true
);

var invalidDetail = sourceValidateDetail(
  {
    name: "",
    genre: [],
    chapters: []
  },
  BASE_URL
);

assert.strictEqual(
  invalidDetail.valid,
  false
);

assert.ok(
  invalidDetail.errors.indexOf("Detail has no name") >= 0
);

/* -------------------------------------------------------------------------- */
/* Video validation                                                           */
/* -------------------------------------------------------------------------- */

var validVideo = sourceValidateVideo(
  {
    url: "https://cdn.example.com/video.m3u8",
    quality: "1080p"
  }
);

assert.strictEqual(
  validVideo.valid,
  true
);

var invalidVideo = sourceValidateVideo(
  {
    quality: "1080p"
  }
);

assert.strictEqual(
  invalidVideo.valid,
  false
);

var videos = sourceValidateVideos([
  {
    url: "https://cdn.example.com/720.m3u8",
    quality: "720p"
  },
  {
    url: "https://cdn.example.com/1080.m3u8",
    quality: "1080p"
  }
]);

assert.strictEqual(
  videos.list.length,
  2
);

/* -------------------------------------------------------------------------- */
/* Empty-result diagnostics                                                   */
/* -------------------------------------------------------------------------- */

var diagnostics = sourceEmptyDiagnostics(
  "search",
  "Kimi wo Aisuru",
  [
    {
      url: "https://example.com/search",
      statusCode: 200
    }
  ]
);

assert.strictEqual(
  diagnostics.type,
  "EMPTY_RESULT"
);

assert.strictEqual(
  diagnostics.method,
  "search"
);

assert.strictEqual(
  diagnostics.query,
  "Kimi wo Aisuru"
);

assert.strictEqual(
  diagnostics.requestCount,
  1
);

assert.ok(
  Array.isArray(diagnostics.suggestions)
);

/* -------------------------------------------------------------------------- */
/* Pagination                                                                 */
/* -------------------------------------------------------------------------- */

var page = sourcePage(
  [
    {
      name: "One Piece",
      link: "https://example.com/one-piece"
    }
  ],
  true
);

assert.strictEqual(
  page.list.length,
  1
);

assert.strictEqual(
  page.hasNextPage,
  true
);

/* -------------------------------------------------------------------------- */
/* Final result                                                               */
/* -------------------------------------------------------------------------- */

console.log(
  "All Animiru extension validation tests passed."
);
