const mangayomiSources = [{
  name: "Loklok",
  id: 638291745,
  lang: "en",
  baseUrl: "https://loklok.tv",
  iconUrl: "https://www.google.com/s2/favicons?sz=256&domain=loklok.tv",
  typeSource: "single",
  itemType: 1,
  version: "1.0.0",
  sourceCodeLanguage: "javascript",
}];

class DefaultExtension extends MProvider {
  constructor() {
    super();

    this.api = "https://ga-mobile-api.loklok.tv/cms/app";
    this.versionCode = "33";
    this.clientType = "android_tem3";
  }

  async request(path, method = "GET", body = null) {
    const client = new Client();

    const headers = {
      "lang": "en",
      "versioncode": this.versionCode,
      "clienttype": this.clientType,
      "deviceid": "animiru-" + Math.random().toString(16).slice(2),
      "Content-Type": "application/json",
    };

    const response = await client.request({
      url: this.api + path,
      method: method,
      headers: headers,
      body: body,
    });

    return JSON.parse(response.body);
  }

  /*
   * Search
   *
   * Equivalent to:
   * POST /search/v2/searchWithKeyWord
   */
  async search(query, page) {
    const result = await this.request(
      "/search/v2/searchWithKeyWord",
      "POST",
      JSON.stringify({
        searchKeyWord: query || "",
        size: 50,
        sort: "",
        searchType: "",
      })
    );

    const results = result.data?.searchResults || [];

    const items = results.map((item) => ({
      name: item.name || "Unknown",
      url: `${item.domainType || 0}:${item.id}`,
      thumbnail: item.coverVerticalUrl || "",
    }));

    return new Mangas(items);
  }

  /*
   * Popular
   *
   * Loklok's API does not provide a separate popular
   * endpoint in the supplied script, so use the search
   * endpoint with an empty query.
   */
  async getPopular(page) {
    return this.search("", page);
  }

  /*
   * Get movie / series details and episodes
   *
   * Equivalent to:
   * GET /movieDrama/get?id=...&category=...
   */
  async getDetail(url) {
    const parts = url.split(":");

    const category = parts[0];
    const contentId = parts[1];

    const result = await this.request(
      `/movieDrama/get?id=${encodeURIComponent(contentId)}&category=${encodeURIComponent(category)}`
    );

    const data = result.data || {};

    const episodeList = data.episodeVo || [];

    const episodes = episodeList.map((episode) => ({
      name: `Episode ${episode.seriesNo ?? episode.id}`,
      url: `${category}:${contentId}:${episode.id}`,
    }));

    return {
      name: data.name || "Unknown",
      thumbnail: data.coverVerticalUrl || "",
      description:
        data.introduction ||
        data.description ||
        "",

      episodes: new Episodes(episodes),
    };
  }

  /*
   * Get playable video
   *
   * Equivalent to:
   * GET /media/previewInfo
   */
  async getVideoList(url) {
    const parts = url.split(":");

    const category = parts[0];
    const contentId = parts[1];
    const episodeId = parts[2];

    /*
     * First retrieve the movie/series details so we
     * can obtain the episode definition and subtitles.
     */
    const detail = await this.request(
      `/movieDrama/get?id=${encodeURIComponent(contentId)}&category=${encodeURIComponent(category)}`
    );

    const episodeList = detail.data?.episodeVo || [];

    const episode = episodeList.find(
      (item) => String(item.id) === String(episodeId)
    );

    if (!episode) {
      return [];
    }

    /*
     * Select the first available video definition.
     */
    const definition =
      episode.definitionList?.[0]?.code || "";

    /*
     * Retrieve the actual media URL.
     */
    const media = await this.request(
      `/media/previewInfo?category=${encodeURIComponent(category)}&contentId=${encodeURIComponent(contentId)}&episodeId=${encodeURIComponent(episodeId)}&definition=${encodeURIComponent(definition)}`
    );

    const mediaUrl = media.data?.mediaUrl;

    if (!mediaUrl) {
      return [];
    }

    /*
     * Convert Loklok subtitles into Animiru subtitles.
     */
    const subtitles = (episode.subtitlingList || [])
      .map((subtitle) => ({
        url: subtitle.subtitlingUrl,
        language:
          subtitle.language ||
          subtitle.languageName ||
          "English",
      }))
      .filter((subtitle) => subtitle.url);

    return new VideoList([
      {
        url: mediaUrl,
        quality: definition
          ? String(definition)
          : "Default",
        headers: {},
        subtitles: subtitles,
      },
    ]);
  }
}
