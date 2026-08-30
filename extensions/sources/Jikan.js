const mangayomiSources = [{
  name: "Jikan + AniList",
  id: 1004,
  lang: "en",

  baseUrl: "https://graphql.anilist.co",
  apiUrl: "https://graphql.anilist.co",

  iconUrl:
    "https://upload.wikimedia.org/wikipedia/commons/7/7a/Jikan_logo.png",

  version: "4.0.0",

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

  /*
   * ---------------------------------------------------------
   * AniList GraphQL
   * ---------------------------------------------------------
   */

  async request(query, variables) {

    const body = JSON.stringify({
      query: query,
      variables: variables || {}
    });

    const response =
      await new Client().post(
        this.apiBase,
        {
          "Content-Type":
            "application/json",

          "Accept":
            "application/json"
        },
        body
      );

    if (
      response.statusCode < 200 ||
      response.statusCode >= 300
    ) {
      throw new Error(
        `AniList API returned HTTP ${response.statusCode}`
      );
    }

    if (
      !response.body ||
      !response.body.trim()
    ) {
      throw new Error(
        "AniList returned an empty response"
      );
    }

    let json;

    try {
      json =
        JSON.parse(response.body);
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

  /*
   * ---------------------------------------------------------
   * Helpers
   * ---------------------------------------------------------
   */

  getTitle(media) {

    return (
      media?.title?.english ||
      media?.title?.romaji ||
      media?.title?.native ||
      "Unknown Anime"
    );
  }

  getImage(media) {

    return (
      media?.coverImage?.extraLarge ||
      media?.coverImage?.large ||
      ""
    );
  }

  cleanDescription(value) {

    if (!value) {
      return "";
    }

    return String(value)
      .replace(
        /<br\s*\/?>/gi,
        "\n"
      )
      .replace(
        /<[^>]*>/g,
        ""
      )
      .replace(
        /&nbsp;/gi,
        " "
      )
      .replace(
        /&amp;/gi,
        "&"
      )
      .replace(
        /&quot;/gi,
        '"'
      )
      .replace(
        /&#39;/gi,
        "'"
      )
      .trim();
  }

  /*
   * Extract an episode number from provider titles.
   *
   * Examples:
   *
   * Episode 1
   * Episode 12
   * Ep 1
   * Ep. 12
   * #1
   * 1
   */

  extractEpisodeNumber(title) {

    const text =
      String(title || "").trim();

    if (!text) {
      return null;
    }

    let match =
      text.match(
        /(?:episode|ep\.?|#)\s*([0-9]+)/i
      );

    if (match) {
      return Number(match[1]);
    }

    match =
      text.match(
        /^\s*([0-9]+)\s*$/
      );

    if (match) {
      return Number(match[1]);
    }

    return null;
  }

  /*
   * Try to determine a provider name from
   * the streaming URL/site returned by AniList.
   */

  getProviderName(episode) {

    if (episode?.site) {
      return String(
        episode.site
      );
    }

    const url =
      String(
        episode?.url || ""
      ).toLowerCase();

    if (
      url.includes("youtube.com") ||
      url.includes("youtu.be")
    ) {
      return "YouTube";
    }

    if (
      url.includes("dailymotion.com") ||
      url.includes("dai.ly")
    ) {
      return "Dailymotion";
    }

    if (
      url.includes("crunchyroll.com")
    ) {
      return "Crunchyroll";
    }

    if (
      url.includes("netflix.com")
    ) {
      return "Netflix";
    }

    if (
      url.includes("hulu.com")
    ) {
      return "Hulu";
    }

    return "Streaming Provider";
  }

  /*
   * Remove duplicate provider URLs.
   */

  uniqueVideos(videos) {

    const seen =
      new Set();

    const result = [];

    for (
      const video
      of videos
    ) {

      const key =
        String(
          video?.url || ""
        ).trim();

      if (!key) {
        continue;
      }

      if (
        seen.has(key)
      ) {
        continue;
      }

      seen.add(key);

      result.push(video);
    }

    return result;
  }

  /*
   * ---------------------------------------------------------
   * Popular
   * ---------------------------------------------------------
   */

  async getPopular(page) {

    const currentPage =
      Number(page) || 1;

    const query = `
      query (
        $page: Int,
        $perPage: Int
      ) {

        Page(
          page: $page,
          perPage: $perPage
        ) {

          pageInfo {
            currentPage
            lastPage
            hasNextPage
          }

          media(
            type: ANIME,
            sort: POPULARITY_DESC,
            isAdult: false
          ) {

            id

            title {
              romaji
              english
              native
            }

            coverImage {
              large
              extraLarge
            }
          }
        }
      }
    `;

    const data =
      await this.request(
        query,
        {
          page:
            currentPage,

          perPage:
            20
        }
      );

    const pageData =
      data?.Page;

    const media =
      Array.isArray(
        pageData?.media
      )
        ? pageData.media
        : [];

    return {

      list:
        media.map(
          (anime) => ({
            name:
              this.getTitle(
                anime
              ),

            imageUrl:
              this.getImage(
                anime
              ),

            link:
              String(
                anime.id
              )
          })
        ),

      hasNextPage:
        Boolean(
          pageData
            ?.pageInfo
            ?.hasNextPage
        )
    };
  }

  /*
   * ---------------------------------------------------------
   * Latest
   * ---------------------------------------------------------
   */

  async getLatestUpdates(page) {

    const currentPage =
      Number(page) || 1;

    const query = `
      query (
        $page: Int,
        $perPage: Int
      ) {

        Page(
          page: $page,
          perPage: $perPage
        ) {

          pageInfo {
            hasNextPage
          }

          media(
            type: ANIME,
            sort: UPDATED_AT_DESC,
            isAdult: false
          ) {

            id

            title {
              romaji
              english
              native
            }

            coverImage {
              large
              extraLarge
            }
          }
        }
      }
    `;

    const data =
      await this.request(
        query,
        {
          page:
            currentPage,

          perPage:
            20
        }
      );

    const pageData =
      data?.Page;

    const media =
      Array.isArray(
        pageData?.media
      )
        ? pageData.media
        : [];

    return {

      list:
        media.map(
          (anime) => ({
            name:
              this.getTitle(
                anime
              ),

            imageUrl:
              this.getImage(
                anime
              ),

            link:
              String(
                anime.id
              )
          })
        ),

      hasNextPage:
        Boolean(
          pageData
            ?.pageInfo
            ?.hasNextPage
        )
    };
  }

  /*
   * ---------------------------------------------------------
   * Search
   * ---------------------------------------------------------
   */

  async search(
    queryText,
    page,
    filters
  ) {

    const currentPage =
      Number(page) || 1;

    const searchText =
      String(
        queryText || ""
      ).trim();

    if (!searchText) {
      return this.getPopular(
        currentPage
      );
    }

    const query = `
      query (
        $page: Int,
        $perPage: Int,
        $search: String
      ) {

        Page(
          page: $page,
          perPage: $perPage
        ) {

          pageInfo {
            hasNextPage
          }

          media(
            search: $search,
            type: ANIME,
            sort: SEARCH_MATCH,
            isAdult: false
          ) {

            id

            title {
              romaji
              english
              native
            }

            coverImage {
              large
              extraLarge
            }
          }
        }
      }
    `;

    const data =
      await this.request(
        query,
        {
          page:
            currentPage,

          perPage:
            20,

          search:
            searchText
        }
      );

    const pageData =
      data?.Page;

    const media =
      Array.isArray(
        pageData?.media
      )
        ? pageData.media
        : [];

    return {

      list:
        media.map(
          (anime) => ({
            name:
              this.getTitle(
                anime
              ),

            imageUrl:
              this.getImage(
                anime
              ),

            link:
              String(
                anime.id
              )
          })
        ),

      hasNextPage:
        Boolean(
          pageData
            ?.pageInfo
            ?.hasNextPage
        )
    };
  }

  /*
   * ---------------------------------------------------------
   * Anime Details
   * ---------------------------------------------------------
   */

  async getDetail(url) {

    const anilistId =
      Number(url);

    if (!anilistId) {
      throw new Error(
        "Invalid AniList ID"
      );
    }

    const query = `
      query ($id: Int) {

        Media(
          id: $id,
          type: ANIME
        ) {

          id

          title {
            romaji
            english
            native
          }

          coverImage {
            large
            extraLarge
          }

          description

          genres

          status

          episodes

          duration

          season

          seasonYear

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
      await this.request(
        query,
        {
          id:
            anilistId
        }
      );

    const anime =
      data?.Media;

    if (!anime) {
      throw new Error(
        "Anime not found"
      );
    }

    const title =
      this.getTitle(
        anime
      );

    const image =
      this.getImage(
        anime
      );

    const description =
      this.cleanDescription(
        anime.description
      );

    const genres =
      Array.isArray(
        anime.genres
      )
        ? anime.genres
        : [];

    const totalEpisodes =
      Number(
        anime.episodes
      ) || 0;

    const episodes = [];

    /*
     * Generate the episode list from
     * AniList's known episode count.
     *
     * If AniList doesn't know the count,
     * use the streaming episode list below.
     */

    if (
      totalEpisodes > 0
    ) {

      for (
        let i = 1;
        i <= totalEpisodes;
        i++
      ) {

        episodes.push({

          name:
            `Episode ${i}`,

          url:
            `${anilistId}|${i}`,

          episodeNumber:
            i
        });
      }

    } else {

      const streamingEpisodes =
        Array.isArray(
          anime.streamingEpisodes
        )
          ? anime.streamingEpisodes
          : [];

      const numbers =
        new Set();

      for (
        const stream
        of streamingEpisodes
      ) {

        const number =
          this.extractEpisodeNumber(
            stream?.title
          );

        if (
          number &&
          !numbers.has(number)
        ) {

          numbers.add(
            number
          );

          episodes.push({

            name:
              `Episode ${number}`,

            url:
              `${anilistId}|${number}`,

            episodeNumber:
              number
          });
        }
      }

      episodes.sort(
        (a, b) =>
          a.episodeNumber -
          b.episodeNumber
      );
    }

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
        String(
          anilistId
        ),

      episodes:
        episodes
    };
  }

  /*
   * ---------------------------------------------------------
   * VIDEO / SERVER RESOLVER
   * ---------------------------------------------------------
   *
   * IMPORTANT:
   *
   * We only return streaming URLs that
   * AniList itself associates with the
   * anime.
   *
   * We do NOT scrape arbitrary websites
   * or bypass provider protection.
   *
   * Multiple legal providers become
   * multiple server choices.
   * ---------------------------------------------------------
   */

  async getVideoList(url) {

    const parts =
      String(url || "")
        .split("|");

    const anilistId =
      Number(
        parts[0]
      );

    const episodeNumber =
      Number(
        parts[1]
      );

    if (
      !anilistId ||
      !episodeNumber
    ) {
      return [];
    }

    const query = `
      query ($id: Int) {

        Media(
          id: $id,
          type: ANIME
        ) {

          id

          title {
            romaji
            english
            native
          }

          episodes

          duration

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
      await this.request(
        query,
        {
          id:
            anilistId
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

    const videos = [];

    /*
     * Find every provider that AniList
     * associates with the selected episode.
     */

    for (
      const episode
      of streamingEpisodes
    ) {

      const number =
        this.extractEpisodeNumber(
          episode?.title
        );

      if (
        number !==
        episodeNumber
      ) {
        continue;
      }

      const streamUrl =
        String(
          episode?.url || ""
        ).trim();

      if (!streamUrl) {
        continue;
      }

      const provider =
        this.getProviderName(
          episode
        );

      /*
       * Mangayomi expects:
       *
       * url
       * originalUrl
       * quality
       */

      videos.push({

        url:
          streamUrl,

        originalUrl:
          streamUrl,

        quality:
          provider
      });
    }

    /*
     * Remove duplicate URLs.
     */

    return this.uniqueVideos(
      videos
    );
  }

  /*
   * ---------------------------------------------------------
   * Status
   * ---------------------------------------------------------
   *
   * Mangayomi source documentation:
   *
   * 0 = ongoing
   * 1 = complete
   * 2 = hiatus
   * 3 = canceled
   * 4 = publishing finished
   * 5 = unknown
   */

  parseStatus(value) {

    const status =
      String(
        value || ""
      ).toUpperCase();

    switch (status) {

      case "RELEASING":
        return 0;

      case "FINISHED":
        return 1;

      case "HIATUS":
        return 2;

      case "CANCELLED":
        return 3;

      case "NOT_YET_RELEASED":
        return 5;

      default:
        return 5;
    }
  }

  /*
   * ---------------------------------------------------------
   * Preferences
   * ---------------------------------------------------------
   */

  getSourcePreferences() {
    return [];
  }
}
