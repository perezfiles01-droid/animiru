const mangayomiSources = [{
  name: "AnimePahe",
  id: 1002,
  lang: "en",
  baseUrl: "https://animepahe.pw",
  apiUrl: "https://animepahe.pw/api",
  iconUrl: "https://animepahe.pw/apple-touch-icon.png",
  version: "1.0.2",
  itemType: 1,
  isNsfw: false,
  hasCloudflare: false,
  isMetadataCapable: true
}];

class DefaultExtension extends MProvider {
  get apiBase() {
    return this.source.apiUrl || `${this.source.baseUrl}/api`;
  }

  buildQuery(pairs) {
    const parts = [];

    for (const [key, value] of pairs) {
      if (value === undefined || value === null) continue;

      parts.push(
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
      );
    }

    return parts.join("&");
  }

  async getJson(url) {
    const res = await new Client().get(url, {
      Accept: "application/json",
      Referer: `${this.source.baseUrl}/`
    });

    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`AnimePahe responded ${res.statusCode}`);
    }

    try {
      return JSON.parse(res.body);
    } catch (_) {
      throw new Error("AnimePahe returned a non-JSON response");
    }
  }

  mapResults(data, page) {
    const items = Array.isArray(data?.data)
      ? data.data
      : [];

    const currentPage = Number(
      data?.current_page ||
      data?.currentPage ||
      page ||
      1
    );

    const lastPage = Number(
      data?.last_page ||
      data?.lastPage ||
      currentPage
    );

    return {
      list: items
        .map((item) => ({
          name: item.title ||
            item.name ||
            "Unknown Anime",

          imageUrl: item.image ||
            item.poster ||
            item.thumbnail ||
            "",

          link: String(
            item.session ||
            item.id ||
            ""
          )
        }))
        .filter((item) => item.link),

      hasNextPage: currentPage < lastPage
    };
  }

  async getPopular(page) {
    const currentPage = Number(page) || 1;

    const url =
      `${this.apiBase}?` +
      this.buildQuery([
        ["m", "filter"],
        ["q", ""],
        ["p", currentPage]
      ]);

    const data = await this.getJson(url);

    return this.mapResults(data, currentPage);
  }

  async getLatestUpdates(page) {
    return this.getPopular(page);
  }

  async search(query, page, filters) {
    const currentPage = Number(page) || 1;

    const url =
      `${this.apiBase}?` +
      this.buildQuery([
        ["m", "search"],
        ["q", query || ""],
        ["p", currentPage]
      ]);

    const data = await this.getJson(url);

    return this.mapResults(data, currentPage);
  }

  async getDetail(url) {
    const id = String(url || "");

    if (!id) {
      throw new Error("Missing anime identifier");
    }

    const metaUrl =
      `${this.apiBase}?` +
      this.buildQuery([
        ["m", "show"],
        ["id", id]
      ]);

    const meta = await this.getJson(metaUrl);

    const title =
      meta?.title ||
      meta?.name ||
      id;

    const image =
      meta?.image ||
      meta?.poster ||
      meta?.thumbnail ||
      "";

    const description = this.plainText(
      meta?.synopsis ||
      meta?.description ||
      ""
    );

    const genre = this.toList(
      meta?.genres ||
      meta?.genre
    );

    const releases = [];

    let page = 1;
    let lastPage = 1;

    do {
      const episodeUrl =
        `${this.apiBase}?` +
        this.buildQuery([
          ["m", "release"],
          ["id", id],
          ["pp", 24],
          ["p", page]
        ]);

      const data = await this.getJson(
        episodeUrl
      );

      if (Array.isArray(data?.data)) {
        releases.push(...data.data);
      }

      lastPage = Number(
        data?.last_page ||
        data?.lastPage ||
        page
      );

      page++;
    } while (page <= lastPage);

    const episodes = releases.map(
      (item, index) => {
        const number =
          item.episode ??
          item.number ??
          item.ep ??
          (index + 1);

        const releaseId =
          item.id ??
          item.session ??
          item.release_id ??
          "";

        return {
          name: `Episode ${number}`,

          url:
            `${id}|${releaseId}|${number}`,

          episodeNumber:
            Number(number) ||
            index + 1
        };
      }
    );

    episodes.sort(
      (a, b) =>
        a.episodeNumber -
        b.episodeNumber
    );

    return {
      name: title,
      imageUrl: image,
      description: description,
      genre: genre,
      status: this.parseStatus(
        meta?.status
      ),
      link: id,
      episodes: episodes
    };
  }

  async getVideoList(url) {
    return [];
  }

  plainText(value) {
    const text =
      Array.isArray(value)
        ? value.join(" ")
        : String(value || "");

    return text
      .replace(
        /<script[\s\S]*?<\/script>/gi,
        " "
      )
      .replace(
        /<style[\s\S]*?<\/style>/gi,
        " "
      )
      .replace(
        /<[^>]*>/g,
        " "
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
      .replace(
        /\s+/g,
        " "
      )
      .trim();
  }

  toList(value) {
    if (!value) {
      return [];
    }

    if (Array.isArray(value)) {
      return value
        .map((item) =>
          String(item).trim()
        )
        .filter(Boolean);
    }

    return String(value)
      .split(/[|,]/)
      .map((item) =>
        item.trim()
      )
      .filter(Boolean);
  }

  parseStatus(value) {
    const status =
      String(value || "")
        .toLowerCase();

    if (
      status.includes("complete") ||
      status.includes("finished")
    ) {
      return 2;
    }

    return 1;
  }

  getSourcePreferences() {
    return [];
  }
}
