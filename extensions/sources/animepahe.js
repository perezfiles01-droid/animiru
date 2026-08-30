const mangayomiSources = [{
    name: "AnimePahe",
    id: 1002,
    lang: "en",
    baseUrl: "https://animepahe.com",
    apiUrl: "https://animepahe.com/api",
    iconUrl: "https://animepahe.com/images/pahe-logo.png",
    version: "1.0.1",
    itemType: 1,
    isNsfw: false,
    hasCloudflare: false,
    isMetadataCapable: true
}];

/**
 * AnimePahe Source.
 *
 * Targets the public JSON API of AnimePahe.
 * Structure:
 * - Root: https://animepahe.com/api
 * - Search/Filter: ?m=filter&q=&p=[page]
 * - Search: ?m=search&q=[query]&p=[page]
 * - Anime Info: ?m=show&id=[id]
 * - Episodes: ?m=release&id=[id]&pp=24&p=[page]
 * - Stream: The release object contains a 'data' field with the iframe URL.
 *
 * Note: AnimePahe frequently changes its frontend, but the API endpoint has been stable.
 * This source assumes the API returns standard JSON objects.
 */
class DefaultExtension extends MProvider {
    
    /**
     * Base API URL
     */
    get apiBase() {
        return "https://animepahe.com/api";
    }

    /**
     * Builds the API query string.
     */
    buildQuery(pairs) {
        const parts = [];
        for (const [key, value] of pairs) {
            parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
        }
        return parts.join("&");
    }

    async getJson(url) {
        const res = await new Client().get(url, { 
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" 
        });
        if (res.statusCode < 200 || res.statusCode >= 300) {
            throw new Error(`API responded ${res.statusCode}`);
        }
        try {
            return JSON.parse(res.body);
        } catch (err) {
            throw new Error("API did not return valid JSON");
        }
    }

    /**
     * Fetches popular anime.
     */
    async getPopular(page) {
        const url = `${this.apiBase}?m=filter&q=&p=${page}`;
        const data = await this.getJson(url);
        
        if (!data || !data.data) return { list: [], hasNextPage: false };

        return {
            list: data.data.map((item) => ({
                name: item.title || "Unknown Anime",
                imageUrl: item.image || "",
                link: String(item.id),
                // Store the session token if needed, though usually not required for this API
                session: item.session
            })),
            hasNextPage: (Number(page) || 0) < (data.current_page || 1)
        };
    }

    /**
     * Fetches latest episodes.
     */
    async getLatestUpdates(page) {
        // AnimePahe doesn't have a direct "latest episodes" API endpoint distinct from search/filter.
        // We can use the filter endpoint sorted by date if available, or fallback to popular.
        // Often, m=filter&q=&p= sorts by newest in some regions, but let's use search for "latest"
        // or reuse getPopular if the API doesn't support sorting. 
        // Better approach: Use m=release with a high ID or specific filter.
        // Fallback to popular for consistency if no sort param is documented.
        return this.getPopular(page);
    }

    /**
     * Search for anime.
     */
    async search(query, page, filters) {
        const url = `${this.apiBase}?m=search&q=${encodeURIComponent(query)}&p=${page}`;
        const data = await this.getJson(url);

        if (!data || !data.data) return { list: [], hasNextPage: false };

        return {
            list: data.data.map((item) => ({
                name: item.title || "Unknown Anime",
                imageUrl: item.image || "",
                link: String(item.id),
                session: item.session
            })),
            hasNextPage: (Number(page) || 0) < (data.current_page || 1)
        };
    }

    /**
     * Get anime details and episodes.
     */
    async getDetail(url) {
        const id = url;
        
        // First, get anime metadata
        const metaUrl = `${this.apiBase}?m=show&id=${id}`;
        const metaRes = await this.getJson(metaUrl);
        
        if (!metaRes) {
            throw new Error("Could not fetch anime details");
        }

        const meta = metaRes;
        const title = meta.title || meta.id || "Unknown";
        const image = meta.image || "";
        const description = meta.synopsis ? this.plainText(meta.synopsis) : "";
        const genre = meta.genres ? meta.genres.join(", ") : "";
        
        // Determine total pages for episodes
        // We need to fetch episodes. AnimePahe API usually requires pagination for episodes.
        // We'll start with page 1 to get the total count.
        
        const epUrl = `${this.apiBase}?m=release&id=${id}&pp=24&p=1`;
        const epRes = await this.getJson(epUrl);

        const episodes = [];
        if (epRes && epRes.data) {
            // Sort episodes by nu