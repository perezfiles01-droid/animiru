const mangayomiSources = [{
  name: "KickAssAnime",
  id: 174839261,
  lang: "en",
  baseUrl: "https://kaa.lt",
  iconUrl: "https://www.google.com/s2/favicons?sz=256&domain=https://kaa.lt",
  typeSource: "single",
  itemType: 1,
  version: "0.1.0",
  isNsfw: false,
  hasCloudflare: false,
  isManga: false,
  appMinVerReq: "0.5.0",
  notes: "KAA metadata and episode-list source.",
}];

class DefaultExtension extends MProvider {
  constructor() {
    super();
    this.client = new Client();
  }

  get ua() {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/135.0.0.0 Safari/537.36";
  }

  get headers() {
    return {
      "User-Agent": this.ua,
      "Referer": this.source.baseUrl + "/",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    };
  }

  async fetchHtml(url) {
    var target = url;

    if (!/^https?:\/\//i.test(target)) {
      target = this.source.baseUrl + "/" + target.replace(/^\/+/, "");
    }

    var response = await this.client.get(target, this.headers);
    return (response && response.body) || "";
  }

  decodeHtml(value) {
    return String(value || "")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .replace(/&#(\d+);/g, function (_, n) {
        return String.fromCharCode(parseInt(n, 10));
      })
      .replace(/&#x([0-9a-fA-F]+);/g, function (_, n) {
        return String.fromCharCode(parseInt(n, 16));
      });
  }

  absoluteUrl(url) {
    if (!url) return "";

    if (/^https?:\/\//i.test(url)) {
      return url;
    }

    if (url.indexOf("//") === 0) {
      return "https:" + url;
    }

    if (url.charAt(0) === "/") {
      return this.source.baseUrl + url;
    }

    return this.source.baseUrl + "/" + url;
  }

  stripHtml(value) {
    return this.decodeHtml(
      String(value || "")
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    );
  }

  get supportsLatest() {
    return true;
  }

  /*
   * Extract anime cards from a KAA page.
   *
   * This intentionally uses generic anchor/image relationships instead of
   * relying on one CSS class so minor presentation changes are less likely
   * to break the extension.
   */
  parseAnimeList(html) {
    var result = [];
    var seen = {};

    var rx = /<a\b([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
    var match;

    while ((match = rx.exec(html)) !== null) {
      var attrsBefore = match[1] || "";
      var href = match[2] || "";
      var attrsAfter = match[3] || "";
      var body = match[4] || "";

      if (!href || href.indexOf("javascript:") === 0) {
        continue;
      }

      /*
       * Look for a recognizable anime slug rather than accepting every
       * navigation link on the page.
       */
      if (!/\/[^\/?#]+(?:\/)?$/i.test(href)) {
        continue;
      }

      var imageMatch = body.match(
        /<img\b[^>]*src=["']([^"']+)["']/i
      );

      var image = imageMatch ? this.absoluteUrl(imageMatch[1]) : "";

      var text = this.stripHtml(body);

      /*
       * Some cards put the title in an attribute instead of visible text.
       */
      if (!text) {
        var titleMatch = (
          attrsBefore + " " + attrsAfter
        ).match(
          /(?:title|aria-label)=["']([^"']+)["']/i
        );

        if (titleMatch) {
          text = this.decodeHtml(titleMatch[1]);
        }
      }

      if (!text || text.length < 2) {
        continue;
      }

      /*
       * Ignore obvious non-anime navigation URLs.
       */
      if (
        /\/(search|login|register|privacy|terms|contact|news|blog|genre|genres|season|schedule)(\/|$|\?)/i.test(href)
      ) {
        continue;
      }

      var link = this.absoluteUrl(href);

      if (seen[link]) {
        continue;
      }

      seen[link] = true;

      result.push({
        name: text.substring(0, 200),
        link: link,
        imageUrl: image,
      });
    }

    return result;
  }

  async getPopular(page) {
    /*
     * KAA may change its browse-page URL over time. The source starts from
     * the site's main catalogue and paginates locally when necessary.
     */
    var html = await this.fetchHtml(this.source.baseUrl + "/");

    var list = this.parseAnimeList(html);

    var pageSize = 30;
    var currentPage = page || 1;
    var start = (currentPage - 1) * pageSize;

    return {
      list: list.slice(start, start + pageSize),
      hasNextPage: start + pageSize < list.length,
    };
  }

  async getLatestUpdates(page) {
    var currentPage = page || 1;

    if (currentPage > 1) {
      return {
        list: [],
        hasNextPage: false,
      };
    }

    var html = await this.fetchHtml(this.source.baseUrl + "/");

    var list = this.parseAnimeList(html);

    return {
      list: list.slice(0, 30),
      hasNextPage: false,
    };
  }

  async search(query, page, filters) {
    var currentPage = page || 1;

    if (!query || !query.trim()) {
      return {
        list: [],
        hasNextPage: false,
      };
    }

    /*
     * KAA search URLs use the search term as part of the catalogue URL.
     * Keep the request isolated here so it is easy to adjust if KAA changes
     * its search route.
     */
    var searchUrl =
      this.source.baseUrl +
      "/search/" +
      encodeURIComponent(query.trim());

    try {
      var html = await this.fetchHtml(searchUrl);
      var list = this.parseAnimeList(html);

      var pageSize = 30;
      var start = (currentPage - 1) * pageSize;

      return {
        list: list.slice(start, start + pageSize),
        hasNextPage: start + pageSize < list.length,
      };
    } catch (e) {
      return {
        list: [],
        hasNextPage: false,
      };
    }
  }

  extractMeta(html, name) {
    var rx = new RegExp(
      "<meta[^>]+(?:name|property)=[\"']" +
      name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
      "[\"'][^>]+content=[\"']([^\"']+)[\"']",
      "i"
    );

    var match = html.match(rx);

    return match ? this.decodeHtml(match[1]) : "";
  }

  extractTitle(html) {
    var ogTitle = this.extractMeta(html, "og:title");

    if (ogTitle) {
      return ogTitle
        .replace(/\s*\|\s*KICKASSANIME.*$/i, "")
        .trim();
    }

    var titleMatch = html.match(
      /<title[^>]*>([\s\S]*?)<\/title>/i
    );

    if (titleMatch) {
      return this.stripHtml(titleMatch[1])
        .replace(/\s*\|\s*KICKASSANIME.*$/i, "")
        .trim();
    }

    return "Unknown";
  }

  extractDescription(html) {
    var description = this.extractMeta(
      html,
      "description"
    );

    if (!description) {
      description = this.extractMeta(
        html,
        "og:description"
      );
    }

    return description || "";
  }

  extractCover(html) {
    var image = this.extractMeta(html, "og:image");

    if (image) {
      return this.absoluteUrl(image);
    }

    var poster = html.match(
      /<img\b[^>]*(?:class|id)=["'][^"']*(?:poster|cover)[^"']*["'][^>]*src=["']([^"']+)["']/i
    );

    return poster
      ? this.absoluteUrl(poster[1])
      : "";
  }

  extractGenres(html) {
    var genres = [];
    var seen = {};

    var rx = /(?:genre|genres)[^<]{0,100}<[^>]*>([\s\S]*?)<\/(?:div|section|ul)>/gi;
    var block;

    while ((block = rx.exec(html)) !== null) {
      var links = block[1].match(
        /<a\b[^>]*>([^<]+)<\/a>/gi
      ) || [];

      for (var i = 0; i < links.length; i++) {
        var name = this.stripHtml(links[i]);

        if (
          name &&
          name.length > 1 &&
          name.length < 50 &&
          !seen[name.toLowerCase()]
        ) {
          seen[name.toLowerCase()] = true;
          genres.push(name);
        }
      }
    }

    return genres;
  }

  statusCode(value) {
    var status = String(value || "").toLowerCase();

    if (
      status.indexOf("finished") >= 0 ||
      status.indexOf("completed") >= 0
    ) {
      return 1;
    }

    if (
      status.indexOf("airing") >= 0 ||
      status.indexOf("ongoing") >= 0 ||
      status.indexOf("releasing") >= 0
    ) {
      return 0;
    }

    if (
      status.indexOf("upcoming") >= 0 ||
      status.indexOf("not yet") >= 0
    ) {
      return 4;
    }

    return 5;
  }

  extractStatus(html) {
    var match = html.match(
      /(?:Status|status)[\s\S]{0,150}?>([^<>]{3,40})</i
    );

    return match
      ? this.statusCode(this.stripHtml(match[1]))
      : 5;
  }

  /*
   * Extract episode links from the anime page.
   *
   * The URL is retained as the episode URL. No attempt is made here to
   * bypass player protection or derive hidden streaming URLs.
   */
  extractEpisodes(html) {
    var chapters = [];
    var seen = {};

    var rx = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    var match;

    while ((match = rx.exec(html)) !== null) {
      var href = match[1];
      var text = this.stripHtml(match[2]);

      if (!href || !text) {
        continue;
      }

      /*
       * Recognize common episode labels.
       */
      var ep = text.match(
        /(?:episode|ep\.?|episodio)\s*[-:#]?\s*(\d+(?:\.\d+)?)/i
      );

      if (!ep) {
        continue;
      }

      var link = this.absoluteUrl(href);

      if (seen[link]) {
        continue;
      }

      seen[link] = true;

      chapters.push({
        name: "Episode " + ep[1],
        url: link,
        isFiller: false,
      });
    }

    /*
     * Sort numerically so Animiru receives a predictable episode order.
     */
    chapters.sort(function (a, b) {
      var an = parseFloat(
        a.name.replace(/[^\d.]/g, "")
      );

      var bn = parseFloat(
        b.name.replace(/[^\d.]/g, "")
      );

      return an - bn;
    });

    return chapters;
  }

  async getDetail(url) {
    var html = await this.fetchHtml(url);

    var title = this.extractTitle(html);
    var image = this.extractCover(html);
    var description = this.extractDescription(html);
    var genre = this.extractGenres(html);
    var status = this.extractStatus(html);
    var chapters = this.extractEpisodes(html);

    return {
      name: title || "Unknown",
      imageUrl: image,
      description: description,
      genre: genre,
      status: status,
      link: url,
      chapters: chapters,
    };
  }

  /*
   * Playback resolver intentionally does not reverse-engineer protected
   * player URLs. If KAA exposes an authorized/public playback endpoint,
   * this method can be connected to that API without changing the rest
   * of the extension.
   */
  async getVideoList(url) {
    return [];
  }

  getFilterList() {
    return [];
  }

  getSourcePreferences() {
    return [];
  }
}
