const mangayomiSources = [{
  name: "Re:ANIME",
  id: 1003,
  lang: "en",
  baseUrl: "https://reanime.to",
  apiUrl: "https://reanime.to",
  iconUrl: "https://reanime.to/favicon.ico",
  version: "2.1.0",
  itemType: 1,
  isNsfw: false,
  hasCloudflare: true,
  isMetadataCapable: true
}];

/**
 * Re:ANIME (reanime.to).
 *
 * The site is behind Cloudflare and serves ordinary server-rendered HTML,
 * so this is a scraper rather than an API client.
 *
 * A word on how it is written. Sites of this kind rename their CSS classes
 * far more often than they change their shape: the markup keeps a grid of
 * links to /anime/<slug> carrying a title and a poster, and a watch page
 * holding an iframe or a playlist, whatever the classes are called this
 * month. So nothing here depends on a single selector. Each thing it needs
 * is looked for several ways, in the order most-specific first, and the
 * first that yields something wins. A source pinned to one class name
 * breaks silently on the next redesign; this one degrades instead.
 *
 * Where a selector is worth correcting by hand it lives in SELECTORS at the
 * top, so the fix is one line and not a rewrite.
 */

/**
 * Tried in order. Adding a better selector at the front of a list is the
 * intended way to sharpen this source against the live site.
 */
const SELECTORS = {
  /** Containers likely to hold a grid of titles. */
  cards: [
    "div.film_list-wrap div.flw-item",
    "div.anime-card",
    "article.anime",
    "div.card",
    "li.anime"
  ],
  /** A link to a title's own page. */
  titleLink: 'a[href*="/anime/"]',
  /** A link to a single episode. */
  episodeLink: 'a[href*="/watch/"], a[href*="/episode/"]',
  /** Where the synopsis usually sits. */
  synopsis: [
    "div.anime-synopsis",
    "div.description",
    "div.synopsis",
    "div.film-description",
    "#synopsis"
  ],
  /** The player itself. */
  player: ["iframe#player", "div#player iframe", "iframe[src]"]
};

class DefaultExtension extends MProvider {
  /**
   * These sites move domain often, and a source pinned to a dead one fails
   * with a network error that reads like a broken extension.
   */
  get siteUrl() {
    const override = String(this.getPreference("reanime_base_url") || "").trim();
    return (override || this.source.baseUrl).replace(/\/+$/, "");
  }

  headers(referer) {
    return {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      Referer: referer || `${this.siteUrl}/`
    };
  }

  /**
   * The second argument to Client.get is the headers themselves. The
   * previous version passed { headers: {...} }, which sent a header named
   * "headers" and none of the ones it meant to send.
   */
  async fetchPage(url, referer) {
    const res = await new Client().get(url, this.headers(referer));

    if (res.statusCode === 403 || res.statusCode === 503) {
      // Not "open it in a browser and retry": the request is made by the
      // Animiru server, not by the reader's device, so nothing they do in
      // their own browser changes what the site sees.
      throw new Error(
        `Re:ANIME refused the request (HTTP ${res.statusCode}). Its bot ` +
        "protection rejects requests coming from the server Animiru runs " +
        "on, which is a hosting provider rather than a phone or a laptop."
      );
    }

    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`Re:ANIME responded ${res.statusCode} for ${url}`);
    }

    const body = String(res.body || "");

    if (/just a moment|cf-browser-verification|challenge-platform/i.test(body)) {
      throw new Error(
        "Re:ANIME served a Cloudflare browser check instead of the page. " +
        "The check is aimed at the Animiru server that made the request, " +
        "not at your device."
      );
    }

    return { doc: new Document(body), body };
  }

  async getPage(url, referer) {
    return (await this.fetchPage(url, referer)).doc;
  }

  /** The first selector in the list that matches anything. */
  firstMatch(doc, selectors) {
    for (const selector of selectors) {
      const found = doc.selectFirst(selector);
      if (found) return found;
    }
    return null;
  }

  /** The first selector in the list that matches more than nothing. */
  firstGroup(doc, selectors) {
    for (const selector of selectors) {
      const found = doc.select(selector);
      if (found && found.length) return found;
    }
    return [];
  }

  absolute(href) {
    const value = String(href || "").trim();
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value;
    return `${this.siteUrl}${value.startsWith("/") ? "" : "/"}${value}`;
  }

  /** Stored as a site-relative path, so a domain change does not strand it. */
  relative(href) {
    const value = String(href || "").trim();
    if (!value) return "";
    return value.replace(/^https?:\/\/[^/]+/i, "") || "";
  }

  imageFrom(node) {
    if (!node) return "";
    const img = node.selectFirst("img");
    if (!img) return "";

    // Lazy-loaded grids put the real poster in a data attribute and a
    // placeholder in src, so src is the last thing to try, not the first.
    const candidate =
      img.attr("data-src") ||
      img.attr("data-original") ||
      img.attr("data-lazy-src") ||
      img.getSrc ||
      "";

    return this.absolute(candidate);
  }

  titleFrom(node, link) {
    const heading = node.selectFirst("h1, h2, h3, h4, .film-name, .title, .name");
    const fromHeading = heading ? this.plainText(heading.text) : "";
    if (fromHeading) return fromHeading;

    const img = node.selectFirst("img");
    const alt = img ? this.plainText(img.attr("alt")) : "";
    if (alt) return alt;

    const attribute = link ? this.plainText(link.attr("title")) : "";
    if (attribute) return attribute;

    return link ? this.plainText(link.text) : "";
  }

  /**
   * Reads a grid of titles out of whatever the page is shaped like. If no
   * known container matches, every link to /anime/ is treated as a card in
   * its own right - which is the shape that survives a redesign.
   */
  toList(doc) {
    let cards = this.firstGroup(doc, SELECTORS.cards);

    if (!cards.length) {
      cards = doc.select(SELECTORS.titleLink);
    }

    const seen = new Set();
    const list = [];

    for (const card of cards) {
      const link =
        card.selectFirst(SELECTORS.titleLink) ||
        (String(card.attr("href") || "").includes("/anime/") ? card : null);

      if (!link) continue;

      const href = this.relative(link.getHref);
      if (!href || seen.has(href)) continue;

      const name = this.titleFrom(card, link);
      if (!name) continue;

      seen.add(href);
      list.push({ name, imageUrl: this.imageFrom(card), link: href });
    }

    return list;
  }

  /** A next page exists only if the page offers one. */
  hasNextPage(doc, page) {
    const next = doc.selectFirst(
      'a[rel="next"], li.page-item.active + li.page-item a, a.next'
    );
    if (next) return true;

    return doc
      .select("a.page-link, ul.pagination a")
      .some((node) => Number(this.plainText(node.text)) > Number(page || 1));
  }

  async browse(path, page) {
    const current = Number(page) || 1;
    const url = `${this.siteUrl}${path}${path.includes("?") ? "&" : "?"}page=${current}`;
    const doc = await this.getPage(url);
    const list = this.toList(doc);

    if (!list.length) {
      throw new Error(
        `Re:ANIME returned a page with no titles on it (${url}). If the ` +
        "site still works in a browser its layout has changed, and the " +
        "selectors in this source need updating."
      );
    }

    return { list, hasNextPage: this.hasNextPage(doc, current) };
  }

  async getPopular(page) {
    return this.browse("/popular", page);
  }

  async getLatestUpdates(page) {
    return this.browse("/recent", page);
  }

  async search(query, page, filters) {
    const current = Number(page) || 1;
    const url =
      `${this.siteUrl}/search?keyword=${encodeURIComponent(String(query || ""))}` +
      `&page=${current}`;

    const doc = await this.getPage(url);

    // An empty search is a legitimate answer, unlike an empty catalogue.
    return { list: this.toList(doc), hasNextPage: this.hasNextPage(doc, current) };
  }

  metaContent(doc, property) {
    const node =
      doc.selectFirst(`meta[property="${property}"]`) ||
      doc.selectFirst(`meta[name="${property}"]`);

    return node ? String(node.attr("content") || "") : "";
  }

  async getDetail(url) {
    const path = this.relative(url);

    if (!path) {
      throw new Error("Missing anime identifier");
    }

    const doc = await this.getPage(`${this.siteUrl}${path}`);

    const heading = doc.selectFirst("h1, h2.film-name, .anime-title");

    const name =
      this.plainText(heading ? heading.text : "") ||
      this.plainText(this.metaContent(doc, "og:title")) ||
      "Unknown Anime";

    const synopsis = this.firstMatch(doc, SELECTORS.synopsis);

    const description =
      this.plainText(synopsis ? synopsis.text : "") ||
      this.plainText(this.metaContent(doc, "og:description")) ||
      this.plainText(this.metaContent(doc, "description"));

    const genre = doc
      .select('a[href*="/genre/"], a[href*="/genres/"]')
      .map((node) => this.plainText(node.text))
      .filter(Boolean);

    return {
      name: name.replace(/\s*[-|]\s*Re:?ANIME\s*$/i, "").trim(),
      imageUrl: this.absolute(this.metaContent(doc, "og:image")) || this.imageFrom(doc),
      description,
      genre: [...new Set(genre)],
      status: this.parseStatus(this.statusText(doc)),
      link: path,
      episodes: this.toEpisodes(doc)
    };
  }

  statusText(doc) {
    for (const node of doc.select("div, span, li, p")) {
      const text = this.plainText(node.text);
      if (/^status\s*:/i.test(text)) return text;
    }
    return "";
  }

  toEpisodes(doc) {
    const seen = new Set();
    const episodes = [];

    for (const link of doc.select(SELECTORS.episodeLink)) {
      const href = this.relative(link.getHref);
      if (!href || seen.has(href)) continue;
      seen.add(href);

      const label =
        this.plainText(link.attr("title")) || this.plainText(link.text);

      // The number may be in the label or only in the URL.
      const found =
        /(?:ep(?:isode)?\.?\s*)(\d+(?:\.\d+)?)/i.exec(label) ||
        /(?:ep(?:isode)?[-_/]?)(\d+(?:\.\d+)?)/i.exec(href) ||
        /(\d+(?:\.\d+)?)\s*$/.exec(label);

      const number = found ? Number(found[1]) : NaN;

      episodes.push({
        name: Number.isFinite(number)
          ? `Episode ${number}`
          : label || "Episode",
        url: href,
        episodeNumber: Number.isFinite(number) ? number : 0
      });
    }

    // Newest first, which is the order the app lists them in.
    episodes.sort((a, b) => b.episodeNumber - a.episodeNumber);

    return episodes;
  }

  async getVideoList(url) {
    const path = this.relative(url);

    if (!path) {
      throw new Error("Missing episode identifier");
    }

    const watchUrl = `${this.siteUrl}${path}`;
    const { doc, body } = await this.fetchPage(watchUrl);
    const videos = [];
    const seen = new Set();

    const add = (streamUrl, quality) => {
      const absolute = this.absolute(streamUrl);
      if (!absolute || seen.has(absolute)) return;
      seen.add(absolute);

      videos.push({
        url: absolute,
        originalUrl: absolute,
        quality,
        // Most embed hosts refuse a request that does not come from the
        // page that embedded them.
        headers: { Referer: `${this.siteUrl}/` }
      });
    };

    // A playlist in the page itself is the best case: it plays directly,
    // with no embed to resolve. This reads the raw response rather than the
    // parsed document, because the URL is usually inside a script tag.
    for (const match of String(body).matchAll(
      /https?:\/\/[^"'\s\\]+\.m3u8[^"'\s\\]*/gi
    )) {
      add(match[0], "Direct");
    }

    // Then the servers the page lists, each an embed.
    const servers = doc.select(
      "[data-src], [data-embed], [data-video], [data-player]"
    );

    for (const server of servers) {
      const embed =
        server.attr("data-src") ||
        server.attr("data-embed") ||
        server.attr("data-video") ||
        server.attr("data-player");

      if (!embed || !/^https?:|^\/\//i.test(embed)) continue;
      add(embed.startsWith("//") ? `https:${embed}` : embed,
        this.plainText(server.text) || this.hostOf(embed));
    }

    // Last, the player frame that is on the page right now.
    const player = this.firstMatch(doc, SELECTORS.player);
    if (player) {
      const src = player.getSrc;
      if (src) add(src.startsWith("//") ? `https:${src}` : src, this.hostOf(src));
    }

    if (!videos.length) {
      throw new Error(
        `Re:ANIME listed no player for this episode (${watchUrl}). The ` +
        "episode may not be published yet, or the page layout has changed."
      );
    }

    // A direct playlist plays without resolving an embed, so it goes first.
    videos.sort((a, b) => (b.quality === "Direct") - (a.quality === "Direct"));

    return videos;
  }

  hostOf(value) {
    const match = /^(?:https?:)?\/\/([^/]+)/i.exec(String(value || ""));
    return match ? match[1].replace(/^www\./i, "") : "Server";
  }

  plainText(value) {
    const text = Array.isArray(value) ? value.join(" ") : String(value || "");

    return text
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Mangayomi's status codes: 0 ongoing, 1 completed, 2 hiatus,
   * 3 canceled, 5 unknown.
   */
  parseStatus(value) {
    const status = String(value || "").toLowerCase();

    if (/ongoing|airing|releasing|currently/.test(status)) return 0;
    if (/completed|finished|ended/.test(status)) return 1;
    if (/hiatus/.test(status)) return 2;
    if (/cancel/.test(status)) return 3;

    return 5;
  }

  getSourcePreferences() {
    return [
      {
        key: "reanime_base_url",
        editTextPreference: {
          title: "Re:ANIME address",
          summary:
            "Change this if Re:ANIME moves domain and the source stops " +
            "loading. Include https:// and no trailing slash.",
          value: "https://reanime.to",
          dialogTitle: "Re:ANIME address",
          dialogMessage: "For example: https://reanime.to"
        }
      }
    ];
  }
}
