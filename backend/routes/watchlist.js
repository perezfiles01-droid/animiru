const express = require('express');
const router = express.Router();

// Mock watchlist database
const watchlists = new Map();

/**
 * Get user's watchlist
 * GET /api/watchlist
 */
router.get('/', (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) {
      return res.status(401).json({ error: 'User ID required' });
    }

    const watchlist = watchlists.get(userId) || [];
    res.json(watchlist);
  } catch (error) {
    next(error);
  }
});

/**
 * Add anime to watchlist
 * POST /api/watchlist
 */
router.post('/', (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) {
      return res.status(401).json({ error: 'User ID required' });
    }

    const { animeId, status = 'PLANNING' } = req.body;
    if (!animeId) {
      return res.status(400).json({ error: 'Anime ID required' });
    }

    let watchlist = watchlists.get(userId) || [];
    const exists = watchlist.find(item => item.animeId === animeId);

    if (exists) {
      return res.status(409).json({ error: 'Already in watchlist' });
    }

    const item = {
      animeId,
      status,
      addedAt: new Date(),
      score: null,
      notes: ''
    };

    watchlist.push(item);
    watchlists.set(userId, watchlist);

    res.status(201).json(item);
  } catch (error) {
    next(error);
  }
});

/**
 * Remove anime from watchlist
 * DELETE /api/watchlist/:animeId
 */
router.delete('/:animeId', (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) {
      return res.status(401).json({ error: 'User ID required' });
    }

    const { animeId } = req.params;
    let watchlist = watchlists.get(userId) || [];

    const filtered = watchlist.filter(item => item.animeId !== parseInt(animeId));
    if (filtered.length === watchlist.length) {
      return res.status(404).json({ error: 'Not in watchlist' });
    }

    watchlists.set(userId, filtered);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * Update watchlist item
 * PUT /api/watchlist/:animeId
 */
router.put('/:animeId', (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) {
      return res.status(401).json({ error: 'User ID required' });
    }

    const { animeId } = req.params;
    let watchlist = watchlists.get(userId) || [];

    const item = watchlist.find(item => item.animeId === parseInt(animeId));
    if (!item) {
      return res.status(404).json({ error: 'Not in watchlist' });
    }

    Object.assign(item, req.body, { updatedAt: new Date() });
    watchlists.set(userId, watchlist);

    res.json(item);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
