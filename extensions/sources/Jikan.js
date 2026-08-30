const mangayomiSources = [{
  name: "Jikan + AniList",
  id: 1004,
  lang: "en",
  baseUrl: "https://myanimelist.net",
  apiUrl: "https://api.jikan.moe/v4",
  iconUrl: "https://upload.wikimedia.org/wikipedia/commons/7/7a/Jikan_logo.png",
  version: "2.0.0",
  itemType: 1,
  isManga: false,
  isNsfw: false,
  hasCloudflare: false,
  isMetadataCapable: true
}];

class DefaultExtension extends MProvider {

  get jikanBase() {
    return this.source.apiUrl;
  }

  get aniListBase() {
    return "https://graphql.anilist.co";
  }

  async jikan(url) {
    const res = await new Client().get(url, {
      Accept: "application/json"
    });

    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(
        `Jikan API returned HTTP ${res.statusCode}`
      );
    }

    try {
      return JSON.parse(res.body);
    } catch (_) {
      throw new Error(
        "Jikan returned invalid JSON"
      );
    }
  }

  async aniList(query, variables) {
    const body = JSON.stringify({
      query: query,
      variables: variables || {}
    });

    const res = await new Client().post(
      this.aniListBase,
      {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body
    );

    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(
        `AniList API returned HTTP ${res.statusCode}`
      );
    }

    let json;

    try {
      json = JSON.parse(res.body);
    } catch (_) {
      throw new Error(
        "AniList returned invalid JSON"
      );
    }

    if (json.errors && json.errors.length > 0) {
      throw new Error(
        json.errors[0].message ||
        "AniList GraphQL error"
      );
    }

    return json.data;
  }

  async getPopular(page) {

    const currentPage =
      Number(page) || 1;

    const url =
      `${this.jikanBase}/top/anime?page=${currentPage}`;

    const data =
      await this.jikan(url);

    const items =
      Array.isArray(data?.data)
        ? data.data
        : [];

    return {
      list: items.map((item) => ({
        name:
          item.title ||
          "Unknown Anime",

        imageUrl:
          item.images?.jpg?.large_image_url ||
          item.images?.jpg?.image_url ||
          "",

        link:
          String(item.mal_id)
      })),

      hasNextPage:
        Boolean(
          data?.pagination?.has_next_page
        )
    };
  }

  async getLatestUpdates(page) {
    return this.getPopular(page);
  }

  async search(query, page, filters) {

    const currentPage =
      Number(page) || 1;

    const url =
      `${this.jikanBase}/anime` +
      `?q=${encodeURIComponent(query || "")}` +
      `&page=${currentPage}` +
      `&sfw=true`;

    const data =
      await this.jikan(url);

    const items =
      Array.isArray(data?.data)
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

        link:
          String(item.mal_id)
      })),

      hasNextPage:
        Boolean(
          data?.pagination?.has_next_page
        )
    };
  }

  async getDetail(url) {

    const malId =
      Number(url);

    if (!malId) {
      throw new Error(
        "Invalid MyAnimeList ID"
      );
    }

    const data =
      await this.jikan(
        `${this.jikanBase}/anime/${malId}`
      );

    const anime =
      data?.data || {};

    const title =
      anime.title ||
      anime.title_english ||
      anime.title_japanese ||
      String(malId);

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
            (g) => g.name
          )
        : [];

    const episodes = [];

    let page = 1;
    let hasNextPage = true;

    while (hasNextPage) {

      const episodeData =
        await this.jikan(
          `${this.jikanBase}/anime/${malId}/episodes?page=${page}`
        );

      const items =
        Array.isArray(
          episodeData?.data
        )
          ? episodeData.data
          : [];

      for (const episode of items) {

        const number =
          Number(episode.mal_id);

        if (!number) {
          continue;
        }

        episodes.push({
          name:
            episode.title
              ? `Episode ${number} - ${episode.title}`
              : `Episode ${number}`,

          url:
            `${malId}|${number}`,

          episodeNumber:
            number
        });
      }

      hasNextPage =
        Boolean(
          episodeData?.pagination?.has_next_page
        );

      page++;

      /*
       * Safety limit.
       * Prevents an accidental endless request
       * for extremely long-running series.
       */
      if (page > 100) {
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

      link:
        String(malId),

      episodes:
        episodes
    };
  }

  async getVideoList(url) {

    const parts =
      String(url || "").split("|");

    const malId =
      Number(parts[0]);

    const episodeNumber =
      Number(parts[1]);

    if (!malId || !episodeNumber) {
      return [];
    }

    /*
     * AniList query.
     *
     * We search by MAL ID so we don't need
     * to guess which AniList entry corresponds
     * to the Jikan result.
     */
    const query = `
      query ($malId: Int) {
        Media(
          idMal: $malId
          type: ANIME
        ) {
          id
          title {
            romaji
            english
          }
          streamingEpisodes {
            title
            thumbnail
            url
            site
          }
        }
      }
    `;

    const data =
      await this.aniList(
        query,
        {
          malId: malId
        }
      );

    const media =
      data?.Media;

    if (!media) {
      return [];
    }

    const streamingEpisodes =
      Array.isArray(
        media.streamingEpisodes
      )
        ? media.streamingEpisodes
        : [];

    const result = [];

    /*
     * AniList's streamingEpisodes titles
     * normally contain the episode number.
     *
     * Match the selected episode rather
     * than returning every streaming link.
     */
    for (
      const episode
      of streamingEpisodes
    ) {

      const title =
        String(
          episode?.title || ""
        );

      const match =
        title.match(
          /(?:episode|ep\.?|#)\s*(\d+)/i
        );

      if (!match) {
        continue;
      }

      const number =
        Number(match[1]);

      if (
        number !== episodeNumber
      ) {
        continue;
      }

      const streamUrl =
        episode?.url;

      if (!streamUrl) {
        continue;
      }

      result.push({
        url:
          streamUrl,

        originalUrl:
          streamUrl,

        quality:
          episode?.site ||
          "Legal Streaming"
      });
    }

    /*
     * Some AniList entries may have a title
     * that doesn't contain "Episode".
     *
     * If no exact match was found, don't
     * incorrectly return another episode.
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
