const mangayomiSources = [{
  name: "Jikan + AniList",
  id: 1004,
  lang: "en",
  baseUrl: "https://graphql.anilist.co",
  apiUrl: "https://graphql.anilist.co",
  iconUrl: "https://upload.wikimedia.org/wikipedia/commons/7/7a/Jikan_logo.png",
  version: "3.0.0",
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

  async request(query, variables) {
    const body = JSON.stringify({
      query: query,
      variables: variables || {}
    });

    const response = await new Client().post(
      this.apiBase,
      {
        "Content-Type": "application/json",
        "Accept": "application/json"
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
      json = JSON.parse(response.body);
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

  async getPopular(page) {

    const currentPage =
      Number(page) || 1;

    const query = `
      query ($page: Int, $perPage: Int) {
        Page(
          page: $page
          perPage: $perPage
        ) {
          pageInfo {
            currentPage
            lastPage
            hasNextPage
          }

          media(
            type: ANIME
            sort: POPULARITY_DESC
            isAdult: false
          ) {
            id
            idMal

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
          page: currentPage,
          perPage: 20
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
              anime.title?.english ||
              anime.title?.romaji ||
              anime.title?.native ||
              "Unknown Anime",

            imageUrl:
              anime.coverImage?.extraLarge ||
              anime.coverImage?.large ||
              "",

            link:
              String(anime.id)
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

  async getLatestUpdates(page) {

    const currentPage =
      Number(page) || 1;

    const query = `
      query ($page: Int, $perPage: Int) {
        Page(
          page: $page
          perPage: $perPage
        ) {
          pageInfo {
            hasNextPage
          }

          media(
            type: ANIME
            sort: UPDATED_AT_DESC
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
          page: currentPage,
          perPage: 20
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
              anime.title?.english ||
              anime.title?.romaji ||
              anime.title?.native ||
              "Unknown Anime",

            imageUrl:
              anime.coverImage?.extraLarge ||
              anime.coverImage?.large ||
              "",

            link:
              String(anime.id)
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

  async search(queryText, page, filters) {

    const currentPage =
      Number(page) || 1;

    const searchText =
      String(queryText || "").trim();

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
          page: $page
          perPage: $perPage
        ) {
          pageInfo {
            hasNextPage
          }

          media(
            search: $search
            type: ANIME
            sort: SEARCH_MATCH
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
          page: currentPage,
          perPage: 20,
          search: searchText
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
              anime.title?.english ||
              anime.title?.romaji ||
              anime.title?.native ||
              "Unknown Anime",

            imageUrl:
              anime.coverImage?.extraLarge ||
              anime.coverImage?.large ||
              "",

            link:
              String(anime.id)
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
          id: $id
          type: ANIME
        ) {
          id
          idMal

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

          startDate {
            year
            month
            day
          }

          endDate {
            year
            month
            day
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
      await this.request(
        query,
        {
          id: anilistId
        }
      );

    const anime =
      data?.Media;

    if (!anime) {
      throw new Error(
        "Anime not found on AniList"
      );
    }

    const title =
      anime.title?.english ||
      anime.title?.romaji ||
      anime.title?.native ||
      String(anilistId);

    const image =
      anime.coverImage?.extraLarge ||
      anime.coverImage?.large ||
      "";

    const description =
      this.cleanDescription(
        anime.description
      );

    const genres =
      Array.isArray(anime.genres)
        ? anime.genres
        : [];

    const totalEpisodes =
      Number(anime.episodes) || 0;

    const episodes = [];

    /*
     * AniList gives us the total episode
     * count but not always a complete
     * per-episode catalog.
     *
     * Generate the known episode numbers.
     */
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
        String(anilistId),

      episodes:
        episodes
    };
  }

  async getVideoList(url) {

    const parts =
      String(url || "")
        .split("|");

    const anilistId =
      Number(parts[0]);

    const episodeNumber =
      Number(parts[1]);

    if (
      !anilistId ||
      !episodeNumber
    ) {
      return [];
    }

    const query = `
      query ($id: Int) {
        Media(
          id: $id
          type: ANIME
        ) {
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
          id: anilistId
        }
      );

    const streamingEpisodes =
      Array.isArray(
        data?.Media
          ?.streamingEpisodes
      )
        ? data.Media.streamingEpisodes
        : [];

    const results = [];

    for (
      const episode
      of streamingEpisodes
    ) {

      const title =
        String(
          episode?.title || ""
        );

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

      results.push({
        url:
          streamUrl,

        originalUrl:
          streamUrl,

        quality:
          episode?.site ||
          "Legal Streaming"
      });
    }

    return results;
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

  parseStatus(value) {

    const status =
      String(value || "")
        .toUpperCase();

    if (
      status === "FINISHED"
    ) {
      return 2;
    }

    if (
      status === "RELEASING"
    ) {
      return 1;
    }

    if (
      status === "NOT_YET_RELEASED"
    ) {
      return 0;
    }

    return 1;
  }

  getSourcePreferences() {
    return [];
  }
}
