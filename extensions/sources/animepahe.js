const mangayomiSources = [{
  name: "AnimePahe",
  id: 1002,
  lang: "en",
  baseUrl: "https://animepahe.org",
  mirrors: [
    "https://animepahe.pw",
    "https://animepahetv.to",
  ],
  apiUrl: "https://animepahe.org/api",
  iconUrl: "https://animepahe.org/apple-touch-icon.png",
  version: "2.3.1",
  itemType: 1,
  isNsfw: false,
  hasCloudflare: true,
  isMetadataCapable: true
}];

/**
 * AnimePahe.
 *
 * The site sits behind DDoS-Guard, which answers a request carrying no
 * cookie and no browser User-Agent with an interstitial rather than the
 * page. Every request here therefore sends the two __ddg cookies the
 * interstitial itself sets, a browser User-Agent, and a Referer - a request
 * missing any of them comes back as HTML where JSON was expected.
 *
 * Four endpoints do the work:
 *
 *   api?m=airing                 the front page, newest releases first
 *   api?m=search&q=              titles, at most eight, unpaged
 *   anime/<session>              one title: poster, synopsis, genres, status
 *   api?m=release&id=<session>   its episodes, paged
 *
 * A "session" is AnimePahe's id for a thing. They are not stable forever -
 * the site rotates them - so an episode is addressed by the pair
 * <anime session>/<episode session>, resolved at the moment it is played
 * rather than stored.
 *
 * Playback goes through kwik, which serves the stream URL inside a packed
 * script. `unpackJs` unpacks it; the sandbox has no eval, deliberately.
 */
class DefaultExtension extends MProvider {
  /**
   * AnimePahe changes domain every so often, and a source pinned to a dead
   * domain fails with a network error that reads like a broken extension.
   * The address is a setting so it can be corrected without editing code
   * or waiting for the source to be updated.
   */
  get siteUrl() {
    const override = String(this.getPreference("animepahe_base_url") || "").trim();
    return (override || this.source.baseUrl).replace(/\/+$/, "");
  }

  get apiBase() {
    return `${this.siteUrl}/api`;
  }

  /**
   * DDoS-Guard checks all three. The cookies are the ones its own
   * interstitial sets, and it accepts them empty.
   */
  /**
   * The header set a real browser sends. Bot protection compares these
   * against what a browser would send, and a request carrying only a
   * User-Agent stands out precisely because everything else is missing.
   *
   * This clears the lightest tier of screening and nothing above it: the
   * heavier tiers fingerprint the TLS handshake, which happens before any
   * of these are read and which no header can change.
   */
  browserHeaders(referer) {
    return {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
      "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": referer ? "same-origin" : "none",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1"
    };
  }

  headersFor(referer) {
    return {
      ...this.browserHeaders(referer),
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9," +
        "image/avif,image/webp,*/*;q=0.8",
      Referer: referer || `${this.siteUrl}/`,
      Cookie: "__ddg1_=;__ddg2_=;"
    };
  }

  /**
   * Returns the body together with the URL that finally answered, which is
   * not always the one asked for - a dead or parked domain redirects the
   * API path to its own front page and answers 200.
   */
  async fetch(url, referer) {
    const res = await new Client().get(url, this.headersFor(referer));

    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(
        `AnimePahe responded ${res.statusCode} for ${url}`
      );
    }

    return { body: String(res.body || ""), url: String(res.url || url) };
  }

  async getText(url, referer) {
    return (await this.fetch(url, referer)).body;
  }

  async getJson(url) {
    const { body, url: answered } = await this.fetch(url);

    try {
      return JSON.parse(body);
    } catch (_) {
      // Three different failures used to be reported as one. Calling a
      // redirect "bot protection" sends the reader looking at the network
      // when the address is what is wrong.
      if (!/[?&]m=/.test(answered)) {
        throw new Error(
          `${this.siteUrl} redirected the request to ${answered}, so there ` +
          "is no API there. That is what a parked or retired AnimePahe " +
          "domain does. Set a working address in this source's settings - " +
          "whichever one loads the real site in your browser."
        );
      }

      if (/ddos-guard|checking your browser|just a moment|cf-browser/i.test(body)) {
        throw new Error(
          "AnimePahe returned a challenge page instead of JSON. Its " +
          "DDoS-Guard bot protection is challenging the request, and the " +
          "challenge is aimed at the Animiru server that made it, not at " +
          "your device."
        );
      }

      throw new Error(
        `AnimePahe answered ${answered} with something that is not JSON. ` +
        `It began: ${body.slice(0, 120).replace(/\s+/g, " ").trim()}`
      );
    }
  }

  buildQuery(pairs) {
    return pairs
      .filter(([, value]) => value !== undefined && value !== null)
      .map(
        ([key, value]) =>
          `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
      )
      .join("&");
  }

  api(pairs) {
    return `${this.apiBase}?${this.buildQuery(pairs)}`;
  }

  /**
   * The airing feed lists episodes, not titles, so one title appears once
   * per episode it released. Collapsing them keeps a page from showing the
   * same show four times.
   */
  fromAiring(data, page) {
    const rows = Array.isArray(data?.data) ? data.data : [];
    const seen = new Set();
    const list = [];

    for (const row of rows) {
      const link = String(row?.anime_session || "");
      if (!link || seen.has(link)) continue;
      seen.add(link);

      list.push({
        name: String(row?.anime_title || "Unknown Anime"),
        imageUrl: String(row?.snapshot || ""),
        link
      });
    }

    const current = Number(data?.current_page) || Number(page) || 1;
    const last = Number(data?.last_page) || current;

    return { list, hasNextPage: current < last };
  }

  async getPopular(page) {
    // AnimePahe publishes no popularity ranking, so this is the airing
    // feed - the same list the site's own front page shows.
    const current = Number(page) || 1;

    return this.fromAiring(
      await this.getJson(this.api([["m", "airing"], ["page", current]])),
      current
    );
  }

  async getLatestUpdates(page) {
    return this.getPopular(page);
  }

  async search(query, page, filters) {
    const data = await this.getJson(
      this.api([["m", "search"], ["q", String(query || "")]])
    );

    const rows = Array.isArray(data?.data) ? data.data : [];

    return {
      list: rows
        .map((row) => ({
          name: String(row?.title || "Unknown Anime"),
          imageUrl: String(row?.poster || ""),
          link: String(row?.session || "")
        }))
        .filter((item) => item.link),

      // Search is a fixed top-eight with no paging. Claiming a next page
      // gives the user a button that loads the same results again.
      hasNextPage: false
    };
  }

  /** Reads one `<p class="anime-<field>"><strong>Label:</strong> value</p>`. */
  infoValue(doc, className) {
    const node = doc.selectFirst(`p.${className}`);
    if (!node) return "";

    return this.plainText(node.text).replace(/^[^:]*:\s*/, "");
  }

  async getDetail(url) {
    const session = String(url || "");

    if (!session) {
      throw new Error("Missing anime identifier");
    }

    const page = await this.getText(`${this.siteUrl}/anime/${session}`);
    const doc = new Document(page);

    const title = this.plainText(
      doc.selectFirst("div.title-wrapper h1 span")?.text ||
      doc.selectFirst("div.title-wrapper h1")?.text ||
      session
    );

    const poster = doc.selectFirst("div.anime-poster img");
    const image = poster ? (poster.attr("data-src") || poster.getSrc || "") : "";

    const synopsis = doc.selectFirst("div.anime-synopsis");

    const genre = doc
      .select("div.anime-genre ul li a")
      .map((node) => this.plainText(node.text))
      .filter(Boolean);

    return {
      name: title,
      imageUrl: String(image || ""),
      description: this.plainText(synopsis ? synopsis.text : ""),
      genre,
      status: this.parseStatus(this.infoValue(doc, "anime-status")),
      link: session,
      episodes: await this.getEpisodes(session)
    };
  }

  async getEpisodes(session) {
    const releases = [];

    let page = 1;
    let lastPage = 1;

    do {
      const data = await this.getJson(
        this.api([
          ["m", "release"],
          ["id", session],
          ["sort", "episode_asc"],
          ["page", page]
        ])
      );

      if (Array.isArray(data?.data)) {
        releases.push(...data.data);
      }

      lastPage = Number(data?.last_page) || page;
      page += 1;

      // A malformed last_page would otherwise page forever. The longest
      // running series on the site is comfortably inside this.
    } while (page <= lastPage && page <= 100);

    const episodes = releases
      .map((row) => {
        const number = Number(row?.episode);
        const episodeSession = String(row?.session || "");

        if (!episodeSession) return null;

        return {
          name: Number.isFinite(number) ? `Episode ${number}` : "Episode",
          url: `${session}/${episodeSession}`,
          episodeNumber: Number.isFinite(number) ? number : 0,
          dateUpload: row?.created_at ? String(row.created_at) : undefined
        };
      })
      .filter(Boolean);

    // Newest first, which is the order the app lists them in.
    episodes.sort((a, b) => b.episodeNumber - a.episodeNumber);

    return episodes;
  }

  async getVideoList(url) {
    const path = String(url || "");

    if (!path.includes("/")) {
      throw new Error("Missing episode identifier");
    }

    const playUrl = `${this.siteUrl}/play/${path}`;
    const doc = new Document(await this.getText(playUrl));

    const buttons = doc.select("div#resolutionMenu button");

    if (!buttons.length) {
      throw new Error(
        "AnimePahe listed no servers for this episode. Newly released " +
        "episodes sometimes take a few minutes to appear."
      );
    }

    const videos = [];
    const failures = [];

    for (const button of buttons) {
      const embed = button.attr("data-src");
      if (!embed) continue;

      const resolution = button.attr("data-resolution") || "";
      const audio = String(button.attr("data-audio") || "").toLowerCase();
      // The button reads "SubsPlease · 1080p". Only the first part names
      // the release group; keeping the rest repeats the resolution.
      const fansub = this.plainText(button.text).split("\u00b7")[0].trim();

      const label = [
        resolution ? `${resolution}p` : "",
        audio === "eng" ? "DUB" : "SUB",
        fansub && !/^\d+p?$/.test(fansub) ? fansub : ""
      ]
        .filter(Boolean)
        .join(" · ");

      try {
        const stream = await this.resolveKwik(embed);

        videos.push({
          url: stream,
          originalUrl: stream,
          quality: label,
          // kwik refuses a request that does not come from its own page.
          headers: { Referer: "https://kwik.si/" }
        });
      } catch (err) {
        failures.push(`${label}: ${err.message}`);
      }
    }

    if (!videos.length) {
      throw new Error(
        `No AnimePahe server could be resolved. ${failures.join("; ")}`
      );
    }

    // Highest resolution first, so the default pick is the best one.
    videos.sort((a, b) => this.qualityRank(b.quality) - this.qualityRank(a.quality));

    return videos;
  }

  qualityRank(label) {
    const match = /(\d{3,4})p/.exec(String(label || ""));
    return match ? Number(match[1]) : 0;
  }

  /**
   * kwik hides the stream URL in a packed script. Unpacking it is the whole
   * extraction - the unpacked text holds a single `source='...'`.
   */
  async resolveKwik(embedUrl) {
    const body = await this.getText(embedUrl, `${this.siteUrl}/`);

    // Packers close with a varying number of parentheses, so the script is
    // taken from the eval to the end of the body and unpackJs finds its own
    // payload inside it. Matching the closing brackets missed real pages.
    const start = body.indexOf("eval(function(p,a,c,k,e,");

    if (start === -1) {
      throw new Error("kwik served a page with no player script");
    }

    const unpacked = unpackJs(body.slice(start));
    const source = /source\s*=\s*['"]([^'"]+)['"]/.exec(String(unpacked || ""));

    if (!source) {
      throw new Error("kwik's player script held no stream URL");
    }

    return source[1];
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
   * 3 canceled, 5 unknown. The previous version of this source returned 2
   * for a finished show, which displayed it as on hiatus.
   */
  parseStatus(value) {
    const status = String(value || "").toLowerCase();

    if (status.includes("currently airing")) return 0;
    if (status.includes("finished")) return 1;
    if (status.includes("hiatus")) return 2;
    if (status.includes("cancel")) return 3;

    return 5;
  }

  getSourcePreferences() {
    return [
      {
        key: "animepahe_base_url",
        editTextPreference: {
          title: "AnimePahe address",
          summary:
            "Change this if AnimePahe moves domain and the source stops " +
            "loading. Include https:// and no trailing slash.",
          value: "https://animepahe.org",
          dialogTitle: "AnimePahe address",
          dialogMessage: "For example: https://animepahe.org"
        }
      }
    ];
  }
}
