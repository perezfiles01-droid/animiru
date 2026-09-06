const mangayomiSources = [{
  name: "Loklok",
  id: 638291745,
  lang: "en",
  baseUrl: "https://loklok.tv",
  iconUrl: "https://www.google.com/s2/favicons?sz=256&domain=loklok.tv",
  typeSource: "single",
  itemType: 1,
  version: "1.0.1",
  sourceCodeLanguage: "javascript",
}];

class DefaultExtension extends MProvider {
  constructor() {
    super();

    this.api = "https://ga-mobile-api.loklok.tv/cms/app";
    this.versionCode = "33";
    this.clientType = "android_tem3";
  }

  headers() {
    return {
      "lang": "en",
      "versioncode": this.versionCode,
      "clienttype": this.clientType,
      "deviceid": "animiru-" + Math.random().toString(16).slice(2),
      "Content-Type": "application/json",
    };
  }

  /*
   * One door out.
   *
   * Client has get/post and nothing else. An earlier version of this file
   * called client.request({ url, method, ... }), which exists in the
   * repository's own sandbox but not in the app - so every method threw
   * "client.request is not a function" on a device while passing here.
   */
  async get(path) {
    const client = new Client();
    const response = await client.get(this.api + path, this.headers());
    return JSON.parse(response.body);
  }

  async post(path, body) {
    const client = new Client();
    const response = await client.post(this.api + path, this.headers(), body);
    return JSON.parse(response.body);
  }

  /*
   * A search result as the app reads one.
   *
   * The field names are not interchangeable: MManga.fromJson reads
   * `imageUrl` and `link`. A card built with `thumbnail` and `url` browses
   * as a blank tile that opens nothing.
   */
  toItem(item) {
    return {
      name: item.name || "Unknown",
      link: (item.domainType || 0) + ":" + item.id,
      imageUrl: item.coverVerticalUrl || item.coverHorizontalUrl || "",
    };
  }

  /*
   * Loklok has no "recently added" endpoint in this API, so the Latest tab
   * is declined rather than faked. Without this the app defaults
   * supportsLatest to true, offers the tab, and calls the base class -
   * which is the "getLatestUpdates not implemented" error users saw.
   */
  get supportsLatest() {
    return false;
  }

  /*
   * Search
   *
   * POST /search/v2/searchWithKeyWord
   */
  async search(query, page, filters) {
    try {
      const result = await this.post(
        "/search/v2/searchWithKeyWord",
        JSON.stringify({
          searchKeyWord: query || "",
          size: 50,
          sort: "",
          searchType: "",
        })
      );

      const results = (result.data && result.data.searchResults) || [];
      const self = this;

      return {
        list: results.map(function (item) { return self.toItem(item); }),
        hasNextPage: false,
      };
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  /*
   * Popular
   *
   * Loklok's API exposes no separate popular endpoint here, so the search
   * endpoint is used with an empty query.
   */
  async getPopular(page) {
    return this.search("", page, []);
  }

  /*
   * One title and its episodes
   *
   * GET /movieDrama/get?id=...&category=...
   */
  async getDetail(url) {
    const parts = String(url).split(":");
    const category = parts[0];
    const contentId = parts[1];

    const result = await this.get(
      "/movieDrama/get?id=" + encodeURIComponent(contentId) +
      "&category=" + encodeURIComponent(category)
    );

    const data = result.data || {};
    const episodeList = data.episodeVo || [];

    const chapters = episodeList.map(function (episode) {
      const number = episode.seriesNo != null ? episode.seriesNo : episode.id;
      return {
        name: "Episode " + number,
        url: category + ":" + contentId + ":" + episode.id,
      };
    });

    return {
      name: data.name || "Unknown",
      imageUrl: data.coverVerticalUrl || data.coverHorizontalUrl || "",
      description: data.introduction || data.description || "",
      link: url,
      genre: [],
      chapters: chapters,
    };
  }

  /*
   * Playable streams
   *
   * GET /media/previewInfo
   */
  async getVideoList(url) {
    const parts = String(url).split(":");
    const category = parts[0];
    const contentId = parts[1];
    const episodeId = parts[2];

    const detail = await this.get(
      "/movieDrama/get?id=" + encodeURIComponent(contentId) +
      "&category=" + encodeURIComponent(category)
    );

    const episodeList = (detail.data && detail.data.episodeVo) || [];

    const episode = episodeList.filter(function (item) {
      return String(item.id) === String(episodeId);
    })[0];

    if (!episode) return [];

    const subtitles = (episode.subtitlingList || [])
      .filter(function (subtitle) { return subtitle.subtitlingUrl; })
      .map(function (subtitle) {
        return {
          file: subtitle.subtitlingUrl,
          label: subtitle.language || subtitle.languageName || "English",
        };
      });

    const definitions = episode.definitionList || [];
    const videos = [];

    /*
     * Every definition the episode offers, so the quality selector has
     * something to select. previewInfo is asked once per definition.
     */
    for (let i = 0; i < definitions.length; i++) {
      const definition = definitions[i].code || "";

      let media;
      try {
        media = await this.get(
          "/media/previewInfo?category=" + encodeURIComponent(category) +
          "&contentId=" + encodeURIComponent(contentId) +
          "&episodeId=" + encodeURIComponent(episodeId) +
          "&definition=" + encodeURIComponent(definition)
        );
      } catch (e) {
        continue;
      }

      const mediaUrl = media.data && media.data.mediaUrl;
      if (!mediaUrl) continue;

      /*
       * originalUrl is required, not decorative: the app drops any video
       * without one before it reaches the player.
       */
      videos.push({
        url: mediaUrl,
        originalUrl: mediaUrl,
        quality: definition ? String(definition) : "Default",
        headers: {},
        subtitles: subtitles,
      });
    }

    return videos;
  }

  getSourcePreferences() {
    return [];
  }
}
