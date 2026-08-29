const mangayomiSources = [{
  name: "Internet Archive",
  id: 1001,
  lang: "en",
  baseUrl: "https://archive.org",
  apiUrl: "https://archive.org",
  iconUrl: "https://archive.org/images/glogo.jpg",
  version: "1.0.0",
  itemType: 1,
  isNsfw: false,
  hasCloudflare: false,
  isMetadataCapable: true
}];

/**
 * Internet Archive.
 *
 * A worked example of a source for Animiru, written against a public JSON
 * API rather than scraped HTML - the parsing is simpler, so what the code
 * shows is the shape of a source rather than a pile of selectors.
 *
 * Three endpoints do everything:
 *
 *   advancedsearch.php   search and browse, returns identifiers
 *   metadata/<id>        one item: its fields and every file it holds
 *   download/<id>/<file> the file itself, playable directly
 *
 * An "episode" here is a video file inside an item, because that is how the
 * Archive stores a series: one item per show, one file per episode. A single
 * film is then just an item holding one file, and needs no special case.
 */
class DefaultExtension extends MProvider {
  /** Only these formats are worth offering a player. */
  get playableFormats() {
    return ["mp4", "m4v", "mkv", "webm", "ogv", "mpeg4", "h.264"];
  }

  /**
   * Builds a query string.
   *
   * The sandbox is a bare JavaScript realm - no URLSearchParams, no fetch,
   * nothing from a browser - so this is done by hand. Repeated keys matter
   * to the Archive's search API (`fl[]`), which is why pairs go in as an
   * array rather than an object.
   */
  buildQuery(pairs) {
    const parts = [];
    for (const [key, value] of pairs) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
    return parts.join("&");
  }

  async getJson(url) {
    const res = await client.get(url, { Accept: "application/json" });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`Archive.org responded ${res.statusCode}`);
    }
    try {
      return JSON.parse(res.body);
    } catch (err) {
      // A non-JSON body means a rate limit page or an outage, not a bug in
      // the query - saying so beats "unexpected token < in JSON".
      throw new Error("Archive.org did not return JSON (rate limited?)");
    }
  }

  /**
   * Runs a search and maps it to the list shape the app expects.
   *
   * `mediatype:movies` keeps the results to things with video in them; the
   * Archive holds far more books and audio than film, so without it a query
   * mostly returns things that cannot be played.
   */
  async query(luceneQuery, page) {
    const url = `${this.source.baseUrl}/advancedsearch.php?` + this.buildQuery([
      ["q", `${luceneQuery} AND mediatype:(movies)`],
      ["fl[]", "identifier"],
      ["fl[]", "title"],
      ["fl[]", "year"],
      ["rows", "24"],
      ["page", String(page || 1)],
      ["output", "json"]
    ]);

    const data = await this.getJson(url);
    const response = data.response || {};
    const docs = response.docs || [];

    return {
      list: docs.map((doc) => ({
        name: doc.title || doc.identifier,
        // The Archive generates a thumbnail for every item, so this never
        // 404s even when the item carries no artwork of its own.
        imageUrl: `${this.source.baseUrl}/services/img/${encodeURIComponent(doc.identifier)}`,
        link: doc.identifier
      })),
      // numFound is the total across all pages, so there is more whenever
      // what we have seen so far falls short of it.
      hasNextPage: (Number(response.start) || 0) + docs.length < (Number(response.numFound) || 0)
    };
  }

  async getPopular(page) {
    return this.query('subject:("anime") OR subject:("animation")', page);
  }

  async getLatestUpdates(page) {
    return this.query('subject:("anime")', page);
  }

  async search(query, page, filters) {
    return this.query(`title:(${query})`, page);
  }

  /**
   * One item, with its playable files as episodes.
   *
   * `link` is the bare identifier rather than a URL: it is what every other
   * endpoint takes, and keeping it in that form means no parsing it back
   * out later.
   */
  async getDetail(url) {
    const identifier = url;
    const data = await this.getJson(
      `${this.source.baseUrl}/metadata/${encodeURIComponent(identifier)}`
    );

    const meta = data.metadata || {};
    const files = data.files || [];

    const playable = files.filter((file) => {
      const format = String(file.format || "").toLowerCase();
      const name = String(file.name || "").toLowerCase();
      return this.playableFormats.some(
        (candidate) => format.includes(candidate) || name.endsWith(`.${candidate}`)
      );
    });

    // The Archive stores several encodes of the same video, so offering
    // every file would list each episode two or three times. One entry per
    // base name, with the alternatives kept for the quality menu.
    const byTitle = {};
    for (const file of playable) {
      const base = String(file.name).replace(/\.[^.]+$/, "");
      if (!byTitle[base]) byTitle[base] = [];
      byTitle[base].push(file);
    }

    const episodes = Object.keys(byTitle).sort().map((base) => ({
      name: base,
      // Identifier and base name are all getVideoList needs, and packing
      // them into the url keeps that call from having to search again.
      url: `${identifier}|${base}`
    }));

    return {
      name: meta.title || identifier,
      imageUrl: `${this.source.baseUrl}/services/img/${encodeURIComponent(identifier)}`,
      description: this.plainText(meta.description),
      genre: this.toList(meta.subject),
      status: 1,
      link: identifier,
      episodes: episodes.reverse()
    };
  }

  /** The Archive's description field is HTML, and sometimes an array of it. */
  plainText(value) {
    const text = Array.isArray(value) ? value.join(" ") : String(value || "");
    return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }

  /** Fields are a string when there is one value and an array when several. */
  toList(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    return String(value).split(",").map((entry) => entry.trim()).filter(Boolean);
  }

  /**
   * The playable URLs for one episode.
   *
   * Every encode of that file becomes an option, labelled by what the
   * Archive calls it. No height is claimed: the metadata rarely states a
   * resolution, and inventing one would mislabel the quality menu.
   */
  async getVideoList(url) {
    const separator = url.lastIndexOf("|");
    const identifier = url.slice(0, separator);
    const base = url.slice(separator + 1);

    const data = await this.getJson(
      `${this.source.baseUrl}/metadata/${encodeURIComponent(identifier)}`
    );

    const matching = (data.files || []).filter(
      (file) => String(file.name).replace(/\.[^.]+$/, "") === base
    );

    const videos = matching.map((file) => ({
      url: `${this.source.baseUrl}/download/${encodeURIComponent(identifier)}/`
        + encodeURIComponent(file.name),
      quality: this.qualityLabel(file),
      originalUrl: `${this.source.baseUrl}/details/${encodeURIComponent(identifier)}`,
      // Carried only to order the list below; the app ignores it.
      bytes: Number(file.size) || 0
    }));

    // Best first, by file size, which is the only proxy for quality the
    // Archive reliably provides.
    videos.sort((a, b) => b.bytes - a.bytes);
    return videos;
  }

  /** A label from whatever the file tells us, in preference order. */
  qualityLabel(file) {
    const name = String(file.name || "");
    const resolution = name.match(/(\d{3,4})p/);
    if (resolution) return resolution[0];

    const format = String(file.format || "").trim();
    if (format) return format;

    const extension = name.match(/\.([^.]+)$/);
    return extension ? extension[1].toUpperCase() : "Original";
  }

  getSourcePreferences() {
    return [];
  }
}
