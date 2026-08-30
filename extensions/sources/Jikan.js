const mangayomiSources = [{
  name: "Jikan + AniList",
  id: 1004,
  lang: "en",
  baseUrl: "https://myanimelist.net",
  apiUrl: "https://api.jikan.moe/v4",
  iconUrl: "https://upload.wikimedia.org/wikipedia/commons/7/7a/Jikan_logo.png",
  version: "2.1.0",
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
    let lastError = null;

    /*
     * Jikan can occasionally return temporary 5xx/429
     * responses. Retry a few times before giving up.
     */
    for (let attempt = 1; attempt <= 3; attempt++) {

      try {
        const res = await new Client().get(url, {
          Accept: "application/json"
        });

        if (
          res.statusCode >= 200 &&
          res.statusCode < 300
        ) {
          if (!res.body || !res.body.trim()) {
            throw new Error(
              "Jikan returned an empty response"
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

        lastError = new Error(
          `Jikan API returned HTTP ${res.statusCode}`
        );

        /*
         * Retry temporary errors only.
         * Don't retry permanent client errors such
         * as 400/401/403/404.
         */
        const retryable =
          res.statusCode === 408 ||
          res.statusCode === 429 ||
          res.statusCode === 500 ||
          res.statusCode === 502 ||
          res.statusCode === 503 ||
          res.statusCode === 504;

        if (!retryable) {
          throw lastError;
        }

      } catch (error) {
        lastError = error;

        /*
         * If this isn't a temporary API/network
         * problem, stop immediately.
         */
        const message =
          String(error?.message || error);

        const retryable =
          message.includes("408") ||
          message.includes("429") ||
          message.includes("500") ||
          message.includes("502") ||
          message.includes("503") ||
          message.includes("504") ||
          message.toLowerCase().includes("timeout");

        if (!retryable) {
          throw error;
        }
      }
    }

    throw lastError ||
      new Error("Jikan request failed");
  }

  async aniList(query, variables) {

    const body = JSON.stringify({
      query: query,
      variables: variables || {}
    });

    let lastError = null;

    for (let attempt = 1; attempt <= 3; attempt++) {

      try {

        const res = await new Client().post(
          this.aniListBase,
          {
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body
        );

        if (
          res.statusCode >= 200 &&
          res.statusCode < 300
        ) {

          let json;

          try {
            json = JSON.parse(res.body);
          } catch (_) {
            throw new Error(
              "AniList returned invalid JSON"
            );
          }

          if (
            json.errors &&
            json.errors.length > 0
          ) {
            throw new Error(
              json.errors[0].message ||
              "AniList GraphQL error"
            );
          }

          return json.data;
        }

        lastError = new Error(
          `AniList API returned HTTP ${res.statusCode}`
        );

        const retryable =
          res.statusCode === 408 ||
          res.statusCode === 429 ||
          res.statusCode === 500 ||
          res.statusCode === 502 ||
          res.statusCode === 503 ||
          res.statusCode === 504;

        if (!retryable) {
          throw lastError;
        }

      } catch (error) {

        lastError = error;

        const message =
          String(error?.message || error);

        const retryable =
          message.includes("408") ||
          message.includes("429") ||
          message.includes("500") ||
          message.includes("502") ||
          message.includes("503") ||
          message.includes("504") ||
          message.toLowerCase().includes("timeout");

        if (!retryable) {
          throw error;
        }
      }
    }

    throw lastError ||
      new Error("AniList request failed");
  }

  mapAnimeList(data) {

    const items =
      Array.isArray(data?.data)
        ? data.data
        : [];

    return items
      .map((item) => ({
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
      }))
      .filter(
        (item) =>
          item.link &&
          item.link !== "undefined"
      );
  }

  async getPopular(page) {

    const currentPage =
      Number(page) || 1;

    /*
     * First attempt:
     * Jikan's top anime endpoint.
     */
    const topUrl =
      `${this.jikanBase}/top/anime?` +
      `page=${currentPage}&limit=10`;

    try {

      const data =
        await this.jikan(topUrl);

      return {
        list:
          this.mapAnimeList(data),

        hasNextPage:
          Boolean(
            data?.pagination?.has_next_page
          )
      };

    } catch (error) {

      /*
       * Fallback:
       * Jikan's regular anime endpoint ordered
       * by score.
       */
      const fallbackUrl =
        `${this.jikanBase}/anime?` +
        `order_by=score&` +
        `sort=desc&` +
        `page=${currentPage}&` +
        `limit=10&` +
        `sfw=true`;

      const data =
        await this.jikan(fallbackUrl);

      return {
        list:
          this.mapAnimeList(data),

        hasNextPage:
          Boolean(
            data?.pagination?.has_next_page
          )
      };
    }
  }

  async getLatestUpdates(page) {

    const currentPage =
      Number(page) || 1;

    /*
     * Use recently aired anime rather than
     * duplicating the top list.
     */
    const url =
      `${this.jikanBase}/anime?` +
      `order_by=aired_from&` +
      `sort=desc&` +
      `page=${currentPage}&` +
      `limit=10&` +
      `sfw=true`;

    const data =
      await this.jikan(url);

    return {
      list:
        this.mapAnimeList(data),

      hasNextPage:
        Boolean(
          data?.pagination?.has_next_page
        )
    };
  }

  async search(query, page, filters) {

    const currentPage =
      Number(page) || 1;

    const cleanQuery =
      String(query || "").trim();

    if (!cleanQuery) {
      return this.getPopular(
        currentPage
      );
    }

    const url =
      `${this.jikanBase}/anime?` +
      `q=${encodeURIComponent(cleanQuery)}` +
      `&page=${currentPage}` +
      `&limit=10` +
      `&sfw=true`;

    const data =
      await this.jikan(url);

    return {
      list:
        this.mapAnimeList(data),

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
            (genre) =>
              genre.name
          )
        : [];

    /*
     * Get episode information.
     */
    const episodes = [];

    let page = 1;
    let hasNextPage = true;

    while (hasNextPage) {

      const episodeUrl =
        `${this.jikanBase}/anime/${malId}/episodes?` +
        `page=${page}` +
        `&limit=100`;

      const episodeData =
        await this.jikan(
          episodeUrl
        );

      const items =
        Array.isArray(
          episodeData?.data
        )
          ? episodeData.data
          : [];

      for (
        const episode
        of items
      ) {

        const number =
          Number(
            episode.mal_id
          );

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
          episodeData
            ?.pagination
            ?.has_next_page
        );

      page++;

      /*
       * Safety limit.
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
      name:
        title,

      imageUrl:
        image,

      description:
        description,

      genre:
        genres,

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
      String(url || "")
        .split("|");

    const malId =
      Number(parts[0]);

    const episodeNumber =
      Number(parts[1]);

    if (
      !malId ||
      !episodeNumber
    ) {
      return [];
    }

    /*
     * Look up the corresponding AniList
     * anime using the MAL ID.
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
          malId:
            malId
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

    for (
      const episode
      of streamingEpisodes
    ) {

      const title =
        String(
          episode?.title || ""
        );

      /*
       * Try several common episode
       * naming formats.
       *
       * Examples:
       *
       * Episode 1
       * Ep 1
       * #1
       * 1
       */
      let match =
        title.match(
          /(?:episode|ep\.?|#)\s*(\d+)/i
        );

      if (!match) {

        match =
          title.match(
            /^\s*(\d+)\s*$/
          );
      }

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

    return result;
  }

  parseStatus(value) {

    const status =
      String(value || "")
        .toLowerCase();

    if (
      status.includes(
        "finished"
      )
    ) {
      return 2;
    }

    if (
      status.includes(
        "airing"
      ) ||
      status.includes(
        "currently"
      )
    ) {
      return 1;
    }

    return 1;
  }

  getSourcePreferences() {
    return [];
  }
}
