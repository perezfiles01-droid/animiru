/**
 * The starting point the maker puts in front of a new source.
 *
 * It is a working extension, not a stub: run it as-is and it fetches a page,
 * parses it and returns a list. That matters more than it sounds - the
 * fastest way to learn this API is to change one selector at a time on
 * something that already works, rather than to build up from nothing.
 */

export const SKELETON = `const mangayomiSources = [{
  name: "My Source",
  id: 1,
  lang: "en",
  baseUrl: "https://example.com",
  iconUrl: "",
  version: "0.0.1",
  itemType: 1,
  // Set false if this source cannot be browsed on its own and should only
  // be asked for episodes of a title found on AniList.
  isMetadataCapable: true
}];

class DefaultExtension extends MProvider {
  // The front page. Return { list, hasNextPage }.
  async getPopular(page) {
    const res = await client.get(\`\${this.source.baseUrl}/popular?page=\${page}\`);
    const doc = new Document(res.body);

    return {
      list: doc.select("div.card").map((el) => ({
        name: el.selectFirst("h3").text(),
        imageUrl: el.selectFirst("img").attr("src"),
        link: el.selectFirst("a").attr("href")
      })),
      hasNextPage: doc.selectFirst("a.next") !== null
    };
  }

  // Recently updated titles. Same shape as getPopular.
  async getLatestUpdates(page) {
    return this.getPopular(page);
  }

  // Free-text search. Same shape again.
  async search(query, page, filters) {
    const res = await client.get(
      \`\${this.source.baseUrl}/search?q=\${encodeURIComponent(query)}&page=\${page}\`
    );
    const doc = new Document(res.body);

    return {
      list: doc.select("div.card").map((el) => ({
        name: el.selectFirst("h3").text(),
        imageUrl: el.selectFirst("img").attr("src"),
        link: el.selectFirst("a").attr("href")
      })),
      hasNextPage: false
    };
  }

  // One title, with its episodes. \`url\` is the link from a list above.
  async getDetail(url) {
    const res = await client.get(url);
    const doc = new Document(res.body);

    return {
      name: doc.selectFirst("h1").text(),
      imageUrl: doc.selectFirst("img.poster").attr("src"),
      description: doc.selectFirst("div.synopsis").text(),
      genre: doc.select("a.genre").map((el) => el.text()),
      status: 0,
      episodes: doc.select("li.episode").map((el) => ({
        name: el.selectFirst("a").text(),
        url: el.selectFirst("a").attr("href")
      }))
    };
  }

  // Playable video for one episode. Return a flat list; each entry is one
  // server at one quality. Add \`headers\` when the host needs a Referer.
  async getVideoList(url) {
    const res = await client.get(url);
    const doc = new Document(res.body);

    return doc.select("source").map((el) => ({
      url: el.attr("src"),
      quality: el.attr("label") || "Default",
      headers: { Referer: this.source.baseUrl }
    }));
  }

  // Settings shown for this source in the app.
  getSourcePreferences() {
    return [];
  }
}
`;

export default SKELETON;
