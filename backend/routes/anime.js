const express = require('express');
const axios = require('axios');
const router = express.Router();

const ANILIST_URL = 'https://graphql.anilist.co';

// Cache for API responses
const cache = new Map();
const CACHE_DURATION = 3600000; // 1 hour

/**
 * Search anime by title
 * GET /api/anime/search?q=naruto&page=1
 */
router.get('/search', async (req, res, next) => {
  try {
    const { q, page = 1 } = req.query;

    if (!q) {
      return res.status(400).json({ error: 'Search query required' });
    }

    const cacheKey = `search_${q}_${page}`;
    if (cache.has(cacheKey)) {
      return res.json(cache.get(cacheKey));
    }

    const query = `
      query($search: String, $page: Int) {
        Page(page: $page, perPage: 20) {
          pageInfo {
            hasNextPage
            currentPage
            lastPage
          }
          media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
            id
            title {
              romaji
              english
              native
            }
            description
            startDate { year month day }
            endDate { year month day }
            coverImage { large medium }
            bannerImage
            genres
            meanScore
            popularity
            episodes
            duration
            status
            studios { nodes { name } }
          }
        }
      }
    `;

    const response = await axios.post(ANILIST_URL, {
      query,
      variables: { search: q, page: parseInt(page) }
    });

    if (response.data.errors) {
      throw new Error(response.data.errors[0].message);
    }

    const data = response.data.data.Page;
    cache.set(cacheKey, data);

    // Clear cache after duration
    setTimeout(() => cache.delete(cacheKey), CACHE_DURATION);

    res.json(data);
  } catch (error) {
    next(error);
  }
});

/**
 * Get anime by ID
 * GET /api/anime/:id
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id || isNaN(id)) {
      return res.status(400).json({ error: 'Valid anime ID required' });
    }

    const cacheKey = `anime_${id}`;
    if (cache.has(cacheKey)) {
      return res.json(cache.get(cacheKey));
    }

    const query = `
      query($id: Int) {
        Media(id: $id, type: ANIME) {
          id
          title {
            romaji
            english
            native
          }
          description
          startDate { year month day }
          endDate { year month day }
          bannerImage
          coverImage { large medium }
          genres
          meanScore
          popularity
          episodes
          duration
          status
          nextAiringEpisode {
            episode
            airingAt
          }
          studios { nodes { name } }
          source
          hashtag
          trailer { id site thumbnail }
          relations {
            edges {
              relationType
              node {
                id
                title { romaji english }
                type
              }
            }
          }
          recommendations {
            edges {
              node {
                mediaRecommendation {
                  id
                  title { romaji }
                  coverImage { large }
                }
              }
            }
          }
        }
      }
    `;

    const response = await axios.post(ANILIST_URL, {
      query,
      variables: { id: parseInt(id) }
    });

    if (response.data.errors) {
      throw new Error(response.data.errors[0].message);
    }

    const data = response.data.data.Media;
    if (!data) {
      return res.status(404).json({ error: 'Anime not found' });
    }

    cache.set(cacheKey, data);
    setTimeout(() => cache.delete(cacheKey), CACHE_DURATION);

    res.json(data);
  } catch (error) {
    next(error);
  }
});

/**
 * Get trending anime
 * GET /api/anime/trending?page=1
 */
router.get('/browse/trending', async (req, res, next) => {
  try {
    const { page = 1 } = req.query;

    const cacheKey = `trending_${page}`;
    if (cache.has(cacheKey)) {
      return res.json(cache.get(cacheKey));
    }

    const query = `
      query($page: Int) {
        Page(page: $page, perPage: 20) {
          pageInfo { hasNextPage currentPage }
          media(type: ANIME, sort: TRENDING_DESC) {
            id
            title { romaji english }
            coverImage { large }
            meanScore
            episodes
            status
          }
        }
      }
    `;

    const response = await axios.post(ANILIST_URL, {
      query,
      variables: { page: parseInt(page) }
    });

    if (response.data.errors) {
      throw new Error(response.data.errors[0].message);
    }

    const data = response.data.data.Page;
    cache.set(cacheKey, data);
    setTimeout(() => cache.delete(cacheKey), CACHE_DURATION);

    res.json(data);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
