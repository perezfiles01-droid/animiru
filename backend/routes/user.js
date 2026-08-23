const express = require('express');
const router = express.Router();

// Mock user profiles database
const userProfiles = new Map();

/**
 * Get user profile
 * GET /api/user/profile
 */
router.get('/profile', (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) {
      return res.status(401).json({ error: 'User ID required' });
    }

    const profile = userProfiles.get(userId) || {
      userId,
      theme: 'dark',
      quality: '720p',
      language: 'en',
      notifications: true,
      newsletter: false
    };

    res.json(profile);
  } catch (error) {
    next(error);
  }
});

/**
 * Update user profile
 * PUT /api/user/profile
 */
router.put('/profile', (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) {
      return res.status(401).json({ error: 'User ID required' });
    }

    const updated = {
      userId,
      ...userProfiles.get(userId),
      ...req.body,
      updatedAt: new Date()
    };

    userProfiles.set(userId, updated);
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

/**
 * Get watch history
 * GET /api/user/history
 */
router.get('/history', (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) {
      return res.status(401).json({ error: 'User ID required' });
    }

    // Mock history data
    const history = [
      { animeId: 1, episodeNumber: 5, watchedAt: new Date(), progress: 0.75 },
      { animeId: 2, episodeNumber: 12, watchedAt: new Date(), progress: 1.0 }
    ];

    res.json(history);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
