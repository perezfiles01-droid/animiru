const mangayomiSources = [{
  name: "KickAssAnime",
  id: 174839261,
  lang: "en",
  baseUrl: "https://kaa.lt",
  apiUrl: "https://kaa.lt/api",
  iconUrl: "https://www.google.com/s2/favicons?sz=256&domain=https://kaa.lt",
  typeSource: "single",
  itemType: 1,
  version: "1.0.0",
  isNsfw: false,
  hasCloudflare: false,
  isManga: false,
  appMinVerReq: "0.5.0",
  notes: "Reads KAA's JSON API. The site is a single-page app: its HTML carries no titles.",
}];

/**
 * KickAssAnime.
 *
 * The previous version scraped <a> tags out of the homepage and always
 * returned nothing, because there is nothing there to find: KAA is a
 * single-page app whose HTML ships an empty shell and fetches the catalogue
 * as JSON afterwards. Reading that API is not an optimisation, it is the
 * only thing that works.
 *
 *   api/show/recent          the front page, newest first
 *   api/show/popular         the popular list
 *   api/search               titles, POSTed as JSON
 *   api/show/<slug>          one title
 *   api/show/<slug>/episodes its episodes, paged
 *   api/show/<slug>/episode/<episode>  the servers for one episode
 *
 * Every reader below tolerates more than one shape. KAA has moved fields
 * between releases - a poster has been a string and an object, a list has
 * been returned bare and wrapped in `result` - and a source pinned to one
 * spelling breaks on the next change with no clue why.
 */
class DefaultExtension extends MProvider {
  get api() {
    return this.source.apiUrl || `${this.source.baseUrl}/api`;
  }

  headers() {
    return {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "application/json",
      Referer: `${this.source.baseUrl}/`
    };
  }

  async getJson(path, body) {
    const url = path.startsWith("http") ? path : `${this.api}${path}`;

    const res = body === undefined
      ? await new Client().get(url, this.headers())
      : await new Client().post(
        url,
        { ...this.headers(), "Content-Type": "application/json" },
        JSON.stringify(body)
      );

    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`KickAssAnime responded ${res.statusCode} for ${url}`);
    }

    const text = String(res.body || "");

    try {
      return JSON.parse(text);
    } catch (_) {
      // The old version's failure mode, named rather than repeated: asking
      // for a page rather than the API returns an HTML shell with no titles
      // in it at all.
      throw new Error(
        `KickAssAnime returned a page rather than JSON for ${url}. Its ` +
        "catalogue lives in the API, not in the HTML."
      );
    }
  }

  /** A list has been returned bare, under `data`, and under `result`. */
  rowsOf(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== "object") return [];

    for (const key of ["result", "data", "shows", "items"]) {
      if (Array.isArray(payload[key])) return payload[key];
    }
    return [];
  }

  /** A poster has been a string, an object of sizes, and a list of formats. */
  posterOf(row) {
    const poster = row?.poster ?? row?.image ?? row?.thumbnail;
    if (!poster) return "";

    if (typeof poster === "string") {
      return /^https?:/i.test(poster)
        ? poster
        : `${this.source.baseUrl}/image/poster/${poster}.webp`;
    }

    const name = poster.hq || poster.sm || poster.name || poster.url || "";
    if (!name) return "";

    return /^https?:/i.test(name)
      ? name
      : `${this.source.baseUrl}/image/poster/${name}.webp`;
  }

  titleOf(row) {
    return row?.title_en || row?.title || row?.name
      || row?.titles?.en || row?.titles?.rj || "Unknown Anime";
  }

  toItem(row) {
    const slug = String(row?.slug || row?.id || "");
    if (!slug) return null;

    return { name: this.titleOf(row), imageUrl: this.posterOf(row), link: slug };
  }

  toList(payload, page) {
    const list = this.rowsOf(payload).map((row) => this.toItem(row)).filter(Boolean);

    const current = Number(page) || 1;
    const pages = Number(payload?.pages ?? payload?.totalPages ?? 0);

    return {
      list,
      // Without a page count, a full-looking page is treated as "there may
      // be more" and an empty one ends the list.
      hasNextPage: pages > 0 ? current < pages : list.length > 0
    };
  }

  async browse(path, page) {
    const current = Number(page) || 1;
    return this.toList(await this.getJson(`${path}?page=${current}`), current);
  }

  async getPopular(page) {
    return this.browse("/show/popular", page);
  }

  async getLatestUpdates(page) {
    return this.browse("/show/recent?type=all", page);
  }

  async search(query, page, filters) {
    const term = String(query || "").trim();
    if (!term) return { list: [], hasNextPage: false };

    // Search is a POST with a JSON body; a GET returns the site's shell.
    return this.toList(await this.getJson("/search", { query: term }), 1);
  }

  /**
   * Mangayomi's status codes: 0 ongoing, 1 completed, 2 hiatus,
   * 3 canceled, 5 unknown.
   */
  parseStatus(value) {
    const status = String(value || "").toLowerCase();

    if (/currently|ongoing|airing|releasing/.test(status)) return 0;
    if (/finished|completed|ended/.test(status)) return 1;
    if (/hiatus/.test(status)) return 2;
    if (/cancel/.test(status)) return 3;

    return 5;
  }

  async getDetail(url) {
    const slug = String(url || "").replace(/^.*\/show\//, "").replace(/\/+$/, "");
    if (!slug) throw new Error("Missing anime identifier");

    const show = await this.getJson(`/show/${encodeURIComponent(slug)}`);
    const row = show?.result ?? show?.data ?? show;

    return {
      // Named explicitly: a detail with no name shows as "Untitled".
      name: this.titleOf(row),
      imageUrl: this.posterOf(row),
      description: this.plainText(row?.synopsis || row?.description || ""),
      genre: Array.isArray(row?.genres)
        ? row.genres.map((genre) => (typeof genre === "string" ? genre : genre?.name)).filter(Boolean)
        : [],
      status: this.parseStatus(row?.status),
      link: slug,
      episodes: await this.getEpisodes(slug)
    };
  }

  async getEpisodes(slug) {
    const episodes = [];
    const seen = new Set();

    let page = 1;
    let pages = 1;

    do {
      const payload = await this.getJson(
        `/show/${encodeURIComponent(slug)}/episodes?ep=${(page - 1) * 100 + 1}&lang=ja-JP`
      );

      for (const row of this.rowsOf(payload)) {
        const episodeSlug = String(row?.slug || row?.episode_slug || "");
        if (!episodeSlug || seen.has(episodeSlug)) continue;
        seen.add(episodeSlug);

        const number = Number(row?.episode_number ?? row?.number ?? row?.episode_string);
        const label = row?.title ? `: ${row.title}` : "";

        episodes.push({
          name: Number.isFinite(number)
            ? `Episode ${number}${label}`
            : String(row?.episode_string || "Episode"),
          url: `${slug}/${episodeSlug}`,
          episodeNumber: Number.isFinite(number) ? number : 0
        });
      }

      const declared = payload?.pages;
      pages = Array.isArray(declared) ? declared.length : Number(declared) || 1;
      page += 1;
      // A malformed page count would otherwise page for ever.
    } while (page <= pages && page <= 40);

    episodes.sort((a, b) => b.episodeNumber - a.episodeNumber);
    return episodes;
  }

  async getVideoList(url) {
    const path = String(url || "");
    const at = path.indexOf("/");
    if (at === -1) throw new Error("Missing episode identifier");

    const slug = path.slice(0, at);
    const episodeSlug = path.slice(at + 1);

    const payload = await this.getJson(
      `/show/${encodeURIComponent(slug)}/episode/${encodeURIComponent(episodeSlug)}`
    );

    const servers = this.rowsOf(payload?.servers ? { result: payload.servers } : payload);
    const videos = [];
    const seen = new Set();

    for (const server of servers) {
      const src = server?.src || server?.url || server?.file || server?.link;
      if (!src || seen.has(src)) continue;
      seen.add(src);

      videos.push({
        url: src,
        originalUrl: src,
        quality: [server?.shortName || server?.name || "KAA", server?.quality]
          .filter(Boolean).join(" · "),
        headers: { Referer: `${this.source.baseUrl}/` }
      });
    }

    if (videos.length === 0) {
      // Said out loud rather than returned as an empty list: a source that
      // returns nothing looks like the app has failed, not the episode.
      throw new Error(
        "KickAssAnime listed no server for this episode. It guards its " +
        "player endpoints and changes them often, so this can happen while " +
        "browsing and episodes still work."
      );
    }

    return videos;
  }

  plainText(value) {
    return String(value || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/\s+/g, " ")
      .trim();
  }

  getSourcePreferences() {
    return [];
  }
}
