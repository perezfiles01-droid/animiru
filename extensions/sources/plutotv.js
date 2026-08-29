const mangayomiSources = [{
  name: "Pluto TV",
  id: 1002,
  lang: "en",
  baseUrl: "https://pluto.tv",
  apiUrl: "https://service-vod.clusters.pluto.tv",
  iconUrl: "https://images.pluto.tv/favicons/favicon-96x96.png",
  version: "1.0.0",
  itemType: 1,
  isNsfw: false,
  hasCloudflare: false,
  isMetadataCapable: true
}];

/**
 * Pluto TV on-demand.
 *
 * Free, ad-supported and legal - no account, no DRM on the on-demand HLS.
 * It carries anime among its categories, which is why it is here rather
 * than one of the subscription services: those are all DRM, and nothing
 * outside their own apps can play them.
 *
 * Playback needs a session. Pluto's boot endpoint hands back a JWT, the
 * address of the stitcher that serves video, and a blob of query parameters
 * that must be appended to every playlist request. A stream URL built
 * without them returns 403, so every call that ends in playback starts by
 * booting.
 *
 * Pluto is region-locked to the countries it operates in. The requests come
 * from wherever the Animiru server runs, not from your device, so a server
 * outside those countries gets an empty catalogue however healthy it looks.
 * That case is reported explicitly below, because "no results" otherwise
 * reads as a broken source.
 */
class DefaultExtension extends MProvider {
  get deviceParams() {
    return [
      ["appName", "web"],
      ["appVersion", "7.5.0"],
      ["deviceVersion", "120.0.0"],
      ["deviceModel", "web"],
      ["deviceMake", "chrome"],
      ["deviceType", "web"],
      ["clientModelNumber", "1.0.0"]
    ];
  }

  buildQuery(pairs) {
    const parts = [];
    for (const [key, value] of pairs) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
    return parts.join("&");
  }

  async getJson(url, headers) {
    const res = await new Client().get(url, headers || {});
    if (res.statusCode === 403) {
      throw new Error(
        "Pluto TV refused the request (403). It is region-locked, and the "
        + "request comes from wherever the Animiru server runs."
      );
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`Pluto TV responded ${res.statusCode}`);
    }
    try {
      return JSON.parse(res.body);
    } catch (err) {
      throw new Error("Pluto TV did not return JSON");
    }
  }

  /**
   * Starts a session.
   *
   * Returns the JWT, the stitcher address and the parameters every playlist
   * request needs. Nothing is cached: each call runs in a fresh sandbox, so
   * there is nowhere for a session to live between them.
   */
  async boot() {
    const clientId = crypto.randomHex(16);
    const url = "https://boot.pluto.tv/v4/start?" + this.buildQuery([
      ...this.deviceParams,
      ["clientID", clientId],
      ["serverSideAds", "false"]
    ]);

    const data = await this.getJson(url);
    const servers = data.servers || {};

    return {
      token: data.sessionToken || "",
      stitcher: servers.stitcher || "https://stitcher-ipv4.pluto.tv",
      stitcherParams: data.stitcherParams || ""
    };
  }

  /** Pluto offers several crops; the tall one is the poster. */
  posterOf(item) {
    const covers = item.covers || [];
    const poster = covers.find((cover) => cover.aspectRatio === "600:900")
      || covers.find((cover) => cover.aspectRatio === "400:600")
      || covers[0];
    return poster ? poster.url : undefined;
  }

  toListItem(item) {
    return {
      name: item.name || item.slug,
      imageUrl: this.posterOf(item),
      // The slug is what the detail endpoint takes, so it is the id.
      link: item.slug || item._id
    };
  }

  /**
   * The on-demand catalogue.
   *
   * Pluto groups everything into categories, so a flat list is every
   * category's items in order. Anime-looking categories come first, since
   * that is what this app is for.
   */
  async getPopular(page) {
    const url = `${this.source.apiUrl}/v4/vod/categories?` + this.buildQuery([
      ["includeItems", "true"],
      ["deviceType", "web"],
      ["page", String(page || 1)],
      ["offset", "0"]
    ]);

    const data = await this.getJson(url);
    const categories = data.categories || [];

    if (categories.length === 0) {
      throw new Error(
        "Pluto TV returned no categories. It is region-locked, so this "
        + "usually means the Animiru server is outside the countries it serves."
      );
    }

    const preferred = [];
    const rest = [];
    for (const category of categories) {
      const name = String(category.name || "").toLowerCase();
      (name.includes("anime") || name.includes("animation") ? preferred : rest)
        .push(category);
    }

    const list = [];
    const seen = {};
    for (const category of [...preferred, ...rest]) {
      for (const item of category.items || []) {
        const key = item.slug || item._id;
        if (!key || seen[key]) continue;
        seen[key] = true;
        list.push(this.toListItem(item));
      }
    }

    return { list, hasNextPage: list.length > 0 };
  }

  async getLatestUpdates(page) {
    return this.getPopular(page);
  }

  async search(query, page, filters) {
    const url = "https://service-media-search.clusters.pluto.tv/v1/search?" + this.buildQuery([
      ["q", query],
      ["limit", "30"],
      ["deviceType", "web"]
    ]);

    const data = await this.getJson(url);
    // The search service has answered under both keys across versions.
    const results = data.data || data.results || data.items || [];

    return {
      list: results
        .filter((item) => item && (item.slug || item._id))
        .map((item) => this.toListItem(item)),
      hasNextPage: false
    };
  }

  /**
   * One title and its episodes.
   *
   * A series carries seasons; a film carries none, and is treated as a
   * single episode so the app has something to play either way.
   */
  async getDetail(url) {
    const slug = url;
    const endpoint = `${this.source.apiUrl}/v4/vod/slugs/${encodeURIComponent(slug)}?`
      + this.buildQuery([["includeItems", "true"], ["deviceType", "web"]]);

    const item = await this.getJson(endpoint);
    const episodes = [];

    for (const season of item.seasons || []) {
      for (const episode of season.episodes || []) {
        episodes.push({
          name: this.episodeName(episode, season),
          // The stitched path is per-episode and is what playback needs, so
          // it travels with the episode rather than being looked up again.
          url: `${episode._id}|${episode.stitched && episode.stitched.path ? episode.stitched.path : ""}`
        });
      }
    }

    if (episodes.length === 0 && item._id) {
      episodes.push({
        name: item.name || slug,
        url: `${item._id}|${item.stitched && item.stitched.path ? item.stitched.path : ""}`
      });
    }

    return {
      name: item.name || slug,
      imageUrl: this.posterOf(item),
      description: String(item.summary || item.description || "").trim(),
      genre: item.genre ? [item.genre] : [],
      status: 1,
      link: slug,
      episodes
    };
  }

  episodeName(episode, season) {
    const number = episode.number || episode.episode;
    const seasonNumber = season.number || episode.season;
    const title = episode.name || "Episode";
    if (seasonNumber && number) return `S${seasonNumber}E${number} - ${title}`;
    if (number) return `Episode ${number} - ${title}`;
    return title;
  }

  /**
   * The playable stream.
   *
   * Pluto serves HLS from a stitcher that splices adverts in, and refuses a
   * request that arrives without the session parameters - so the URL is
   * assembled from a fresh boot every time rather than stored.
   */
  async getVideoList(url) {
    const separator = url.indexOf("|");
    const episodeId = separator === -1 ? url : url.slice(0, separator);
    const stitchedPath = separator === -1 ? "" : url.slice(separator + 1);

    const session = await this.boot();

    const path = stitchedPath
      || `/v2/stitch/hls/episode/${encodeURIComponent(episodeId)}/master.m3u8`;

    const joiner = path.indexOf("?") === -1 ? "?" : "&";
    const streamUrl = `${session.stitcher}${path}${joiner}${session.stitcherParams}`
      + (session.token ? `&jwt=${encodeURIComponent(session.token)}` : "");

    return [{
      url: streamUrl,
      originalUrl: streamUrl,
      // Pluto serves one adaptive playlist; the player picks a rendition
      // from it, so claiming tiers here would be inventing them.
      quality: "Auto (HLS)"
    }];
  }

  getSourcePreferences() {
    return [];
  }
}
