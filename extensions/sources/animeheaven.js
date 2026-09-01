const mangayomiSources = [
  {
    "name": "AnimeHeaven",
    "id": -1744325818,
    "lang": "en",
    "baseUrl": "https://animeheaven.me",
    "iconUrl": "https://www.google.com/s2/favicons?sz=256&domain=https://animeheaven.me",
    "typeSource": "single",
    "itemType": 1,
    "version": "0.0.7",
    "pkgPath": "anime/src/en/animeheaven.js",
    "isManga": false,
    "isNsfw": false,
    "hasCloudflare": false,
    "isFullData": false,
    "appMinVerReq": "0.5.0",
    "sourceCodeUrl": "https://raw.githubusercontent.com/Mallyd11/mangayomi-anime-extensions/refs/heads/main/javascript/anime/src/en/animeheaven.js",
    "dateFormat": "",
    "dateFormatLocale": "",
    "additionalParams": "",
    "sourceCodeLanguage": 1,
    "notes": "",
  },
];

class DefaultExtension extends MProvider {
  constructor() {
    super();
    this.client = new Client();
  }

  get ua() {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
  }

  get headers() {
    return {
      "User-Agent": this.ua,
      "Referer": this.source.baseUrl + "/",
    };
  }

  async fetchHtml(path) {
    var url = path.startsWith("http") ? path : this.source.baseUrl + "/" + path.replace(/^\/+/, "");
    var res = await this.client.get(url, this.headers);
    return res.body || "";
  }

  // Parsed rather than matched, as AniWave and AniNeko read their pages. A
  // regex over raw HTML breaks on any markup change and needs its own
  // entity decoding; the parser gives that free.
  async fetchDoc(path) {
    return new Document(await this.fetchHtml(path));
  }

  /** A site path made absolute, leaving one that already is. */
  _abs(value) {
    if (!value) return "";
    return value.indexOf("http") === 0
      ? value
      : this.source.baseUrl + "/" + value.replace(/^\/+/, "");
  }

  // Parse a list page (popular.php / new.php / search.php).
  // Site structure per item:
  //   <a href="anime.php?CODE"><img src="image.php?CODE"></a>
  //   <a href="anime.php?CODE">Title Text</a>
  // Attributes use double quotes; no class on img tags.
  parseList(doc) {
    var list = [];
    var seen = {};
    var anchors = doc.select('a[href^="anime.php?"]');

    // The cover and the title sit in different anchors that share an href,
    // so the covers are collected first and matched by it.
    var covers = {};
    for (var i = 0; i < anchors.length; i++) {
      var img = anchors[i].selectFirst("img");
      if (!img) continue;
      var key = anchors[i].attr("href");
      if (key && !covers[key]) covers[key] = img.attr("src") || "";
    }

    for (var j = 0; j < anchors.length; j++) {
      var anchor = anchors[j];
      // A title anchor holds plain text and nothing else. One wrapping any
      // markup is the cover, or a card, and its text would be assembled
      // from whatever it contains.
      if ((anchor.innerHtml || "").indexOf("<") !== -1) continue;

      var href = anchor.attr("href");
      var name = (anchor.text || "").trim();
      if (!href || !name || seen[href]) continue;
      if (name.length < 2 || name.length > 120) continue;

      seen[href] = true;
      list.push({
        name: name,
        link: this._abs(href),
        imageUrl: covers[href] ? this._abs(covers[href]) : "",
      });
    }
    return list;
  }

  get supportsLatest() {
    return true;
  }

  async getPopular(page) {
    // The site returns all items on one HTML page. We slice client-side so
    // Mangayomi only receives 30 items at a time and can load more on scroll.
    var all = this.parseList(await this.fetchDoc("popular.php"));
    var pageSize = 30;
    var start = (page - 1) * pageSize;
    var slice = all.slice(start, start + pageSize);
    return { list: slice, hasNextPage: (start + pageSize) < all.length };
  }

  async getLatestUpdates(page) {
    var all = this.parseList(await this.fetchDoc("new.php"));
    var pageSize = 30;
    var start = (page - 1) * pageSize;
    var slice = all.slice(start, start + pageSize);
    return { list: slice, hasNextPage: (start + pageSize) < all.length };
  }

  async search(query, page, filters) {
    if (page > 1) return { list: [], hasNextPage: false };
    try {
      var doc = await this.fetchDoc("search.php?s=" + encodeURIComponent(query));
      return { list: this.parseList(doc), hasNextPage: false };
    } catch (e) {
      return { list: [], hasNextPage: false };
    }
  }

  // Status mapping. AnimeHeaven uses "Currently Airing" / "Finished Airing".
  statusCode(status) {
    var s = (status || "").toLowerCase();
    if (s.includes("finished") || s.includes("completed")) return 1;
    if (s.includes("not yet") || s.includes("upcoming")) return 4;
    if (s.includes("airing") || s.includes("ongoing") || s.includes("releasing")) return 0;
    return 5;
  }

  async getDetail(url) {
    var doc = await this.fetchDoc(url);

    var titleEl = doc.selectFirst(".infotitle");
    var name = titleEl ? (titleEl.text || "").trim() : "";

    // The detail page's own poster carries class posterimg. Not coverimg:
    // those are the related-anime thumbnails lower down. og:image always
    // points at the right art and stands in when there is no poster.
    var imageUrl = "";
    var poster = doc.selectFirst("img.posterimg");
    if (poster) imageUrl = this._abs(poster.attr("src"));
    if (!imageUrl) {
      var og = doc.selectFirst('meta[property="og:image"]');
      if (og) imageUrl = og.attr("content") || "";
    }

    var descEl = doc.selectFirst(".infodes");
    var description = descEl ? (descEl.text || "").replace(/\s+/g, " ").trim() : "";

    // Every tags.php link in the tag section is a genre.
    var genre = [];
    var seenGenre = {};
    var tagSection = doc.selectFirst(".infotags");
    var tags = tagSection
      ? tagSection.select('a[href^="tags.php?"]')
      : doc.select('a[href^="tags.php?"]');
    for (var g = 0; g < tags.length; g++) {
      var label = (tags[g].text || "").trim();
      if (!label) {
        // A tag link with no text still names itself in the query.
        var q = (tags[g].attr("href") || "").match(/tag=([^&']+)/);
        if (q) label = decodeURIComponent(q[1]);
      }
      if (label && !seenGenre[label]) {
        seenGenre[label] = true;
        genre.push(label);
      }
    }

    // Sidebar rows: <div class='inline c'>Status</div><div class='inline c2'>...</div>
    var status = 5;
    var labels = doc.select(".inline.c");
    for (var i = 0; i < labels.length; i++) {
      if ((labels[i].text || "").trim().toLowerCase() !== "status") continue;
      var value = labels[i].nextElementSibling;
      if (value) status = this.statusCode((value.text || "").trim());
      break;
    }

    // Every anchor with an onclick of gatea(...) is an episode; the key it
    // passes is the chapter url, and the number is in the watch2 element
    // the anchor wraps.
    var chapters = [];
    var episodes = doc.select("a[onclick]");
    for (var e = 0; e < episodes.length; e++) {
      var onclick = episodes[e].attr("onclick") || "";
      var key = onclick.match(/gatea\(\\?["']([a-f0-9]+)\\?["']\)/);
      if (!key) continue;

      var numberEl = episodes[e].selectFirst(".watch2");
      var number = numberEl ? (numberEl.text || "").trim().match(/^(\d+(?:\.\d+)?)/) : null;
      chapters.push({
        name: "Episode " + (number ? number[1] : String(chapters.length + 1)),
        url: key[1],
      });
    }

    // The site already lists newest first, which is the order the app wants.
    return {
      name: name,
      imageUrl: imageUrl,
      description: description,
      genre: genre,
      status: status,
      link: url,
      chapters: chapters,
    };
  }

  // Fetch the gate.php page for an episode and pull every video URL out of it.
  async getVideoList(url) {
    var hash = url; // we stored just the hash as the chapter URL
    var streams = [];

    var refer = this.source.baseUrl + "/anime.php";
    var headers = {
      "User-Agent": this.ua,
      "Referer": refer,
      "Cookie": "key=" + hash,
    };
    var res;
    try {
      res = await this.client.get(this.source.baseUrl + "/gate.php", headers);
    } catch (e) {
      return streams;
    }
    var html = res.body || "";

    // Pull every distinct mp4 URL. Different subdomains rotate per refresh, but
    // each page lists ax/ct/ck etc. as fallbacks. We surface them as quality options.
    var seen = {};
    var rx = /['"](https?:\/\/[\w\-]+\.animeheaven\.me\/video\.mp4\?[^'"\s]+)['"]/g;
    var m;
    // The video CDN validates access via the token embedded in the URL query
    // string, not via cookies. Sending only UA + Referer keeps the request
    // clean and avoids any cookie-related rejection by the CDN or downloader.
    var streamHeaders = {
      "User-Agent": this.ua,
      "Referer": this.source.baseUrl + "/",
    };
    while ((m = rx.exec(html)) !== null) {
      var u = m[1];
      // The player embeds three kinds of URL suffix:
      //   &error  → Server 2 fallback
      //   &error2 → Server 3 fallback
      //   &d      → "download alias" — INTENTIONALLY omits the access token,
      //             making it a different (broken) URL that returns HTTP 404.
      //             Skip it; the full-token Server 1–3 URLs are downloadable.
      if (/&d(\b|$)/.test(u)) continue;

      // Strip &error / &error2 to get the clean URL with the access token.
      var clean = u.replace(/&error2?$/, "");
      if (seen[clean]) continue;
      seen[clean] = true;

      // Label by suffix so users can pick a fallback if the primary fails.
      var label;
      if (/&error2(\b|$)/.test(u)) label = "Server 3";
      else if (/&error(\b|$)/.test(u)) label = "Server 2";
      else label = "Server 1";

      streams.push({
        url: clean,
        originalUrl: clean,
        quality: label,
        headers: streamHeaders,
        subtitles: [],
      });
    }
    return streams;
  }

  getFilterList() {
    return [];
  }

  getSourcePreferences() {
    return [];
  }
}
