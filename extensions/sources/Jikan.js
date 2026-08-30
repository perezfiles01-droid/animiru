const mangayomiSources = [{
  name: "Jikan Anime",
  id: 1003,
  lang: "en",
  baseUrl: "https://myanimelist.net",
  apiUrl: "https://api.jikan.moe/v4",
  iconUrl: "https://upload.wikimedia.org/wikipedia/commons/7/7a/Jikan_logo.png",
  version: "1.0.0",
  itemType: 1,
  isManga: false,
  isNsfw: false,
  hasCloudflare: false,
  isMetadataCapable: true
}];

class DefaultExtension extends MProvider {

  get apiBase() {
    return this.source.apiUrl;
  }

  buildQuery(pairs) {
    const parts = [];

    for (const [key, value] of pairs) {
      if (value === undefined || value === null || value === "") {
        continue;
      }

      parts.push(
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
      );
    }

    return parts.join("&");
  }

  async getJson(url) {
    const res = await new Client().get(url, {
      Accept: "application/json"
    });

    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(
        `Jikan API responded ${res.statusCode}`
      );
    }

    try {
      return JSON.parse(res.body);
    } catch (_) {
      throw new Error(
        "Jikan returned an invalid JSON response"
      );
    }
  }

  async getPopular(page) {
    const currentPage = Number(page) || 1;

    const url =
      `${this.apiBase}/top/anime?` +
      this.buildQuery([
        ["page", currentPage]
      ]);

    const data = await this.getJson(url);

    const items = Array.isArray(data?.data)
      ? data.data
      : [];

    return {
      list: items.map((item) => ({
        name: item.title || "Unknown Anime",

        imageUrl:
          item.images?.jpg?.large_image_url ||
          item.images?.jpg?.image_url ||
          "",

        link: String(item.mal_id)
      })),

      hasNextPage:
        Boolean(data?.pagination?.has_next_page)
    };
  }

  async getLatestUpdates(page) {
    return this.getPopular(page);
  }

  async search(query, page, filters) {
    const currentPage = Number(page) || 1;

    const url =
      `${this.apiBase}/anime?` +
      this.buildQuery([
        ["q", query || ""],
        ["page", currentPage],
        ["sfw", true]
      ]);

    const data = await this.getJson(url);

    const items = Array.isArray(data?.data)
      ? data.data
      : [];

    return {
      list: items.map((item) => ({
        name:
          item.title ||
          item.title_english ||
          "Unknown Anime",

        imageUrl:
          item.images?.jpg?.large_image_url ||
          item.images?.jpg?.image_url ||
          "",

        link: String(item.mal_id)
      })),

      hasNextPage:
        Boolean(data?.pagination?.has_next_page)
    };
  }

  async getDetail(url) {
    const id = String(url || "");

    if (!id) {
      throw new Error(
        "Missing MyAnimeList ID"
      );
    }

    const animeData =
      await this.getJson(
        `${this.apiBase}/anime/${encodeURIComponent(id)}`
      );

    const anime = animeData?.data || {};

    const title =
      anime.title ||
      anime.title_english ||
      anime.title_japanese ||
      id;

    const image =
      anime.images?.jpg?.large_image_url ||
      anime.images?.jpg?.image_url ||
      "";

    const description =
      anime.synopsis ||
      "";

    const genres =
      Array.isArray(anime.genres)
        ? anime.genres.map(
            (genre) => genre.name
          )
        : [];

    const episodes = [];

    let page = 1;
    let hasNextPage = true;

    while (hasNextPage) {

      const episodeData =
        await this.getJson(
          `${this.apiBase}/anime/${encodeURIComponent(id)}/episodes?page=${page}`
        );

      const items =
        Array.isArray(episodeData?.data)
          ? episodeData.data
          : [];

      for (const item of items) {

        const number =
          Number(item.mal_id);

        episodes.push({
          name:
            item.title
              ? `Episode ${number} - ${item.title}`
              : `Episode ${number}`,

          url:
            `${id}|${number}`,

          episodeNumber:
            number || episodes.length + 1
        });
      }

      hasNextPage =
        Boolean(
          episodeData?.pagination?.has_next_page
        );

      page++;

      if (page > 50) {
        break;
      }
    }

    episodes.sort(
      (a, b) =>
        a.episodeNumber -
        b.episodeNumber
    );

    return {
      name: title,

      imageUrl: image,

      description: description,

      genre: genres,

      status:
        this.parseStatus(
          anime.status
        ),

      link: id,

      episodes: episodes
    };
  }

  async getVideoList(url) {

    const parts =
      String(url || "").split("|");

    const animeId = parts[0];

    const episodeNumber =
      Number(parts[1]);

    if (!animeId) {
      return [];
    }

    const videoData =
      await this.getJson(
        `${this.apiBase}/anime/${encodeURIComponent(animeId)}/videos`
      );

    const videos =
      videoData?.data?.episodes || [];

    const promos =
      videoData?.data?.promo || [];

    const result = [];

    /*
     * Jikan's episode-video objects are
     * metadata references rather than
     * full episode streams.
     *
     * We therefore only add playable
     * YouTube videos when Jikan supplies
     * an actual YouTube ID.
     */

    for (const item of promos) {

      const trailer =
        item?.trailer;

      if (!trailer) {
        continue;
      }

      const youtubeId =
        trailer.youtube_id;

      if (!youtubeId) {
        continue;
      }

      const youtubeUrl =
        `https://www.youtube.com/watch?v=${youtubeId}`;

      result.push({
        url: youtubeUrl,

        originalUrl:
          youtubeUrl,

        quality:
          item.title ||
          "Official YouTube Video"
      });
    }

    /*
     * Jikan's episode list does not normally
     * contain a playable video URL.
     *
     * Do not pretend the MAL episode page
     * itself is a video stream.
     */

    return result;
  }

  parseStatus(value) {

    const status =
      String(value || "")
        .toLowerCase();

    if (
      status.includes("finished")
    ) {
      return 2;
    }

    if (
      status.includes("airing") ||
      status.includes("currently")
    ) {
      return 1;
    }

    return 1;
  }

  getSourcePreferences() {
    return [];
  }
}
