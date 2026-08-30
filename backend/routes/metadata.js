/**
 * Watch order and recommendations.
 *
 * Separate from /api/extensions because it is not an extension: the data
 * comes from AniList, and no source is involved. Keeping it apart also
 * means a failure here says "metadata is unavailable" rather than looking
 * like the source has broken.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const anilist = require('../metadata/anilist');

const router = express.Router();

// AniList allows 90 requests a minute per IP, and this server shares one
// address across every user, so it is worth staying well under.
router.use(rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many metadata requests. Try again in a minute.' }
}));

/** Turns any failure into a shape the app can show without guessing. */
const handle = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    res.status(502).json({
      error: err && err.message ? err.message : 'AniList could not be reached',
      // The detail screen keeps working without this, so the app needs to
      // know the failure is confined to metadata.
      scope: 'metadata'
    });
  }
};

router.get('/search', handle(async (req) => ({
  results: await anilist.search(req.query.title)
})));

router.get('/season', handle(async (req) => anilist.getSeason({
  season: req.query.season,
  year: req.query.year,
  page: req.query.page
})));

router.get('/watch-order', handle(async (req) => ({
  entries: await anilist.getWatchOrder(req.query.id)
})));

router.get('/recommendations', handle(async (req) => ({
  results: await anilist.getRecommendations(req.query.id)
})));

module.exports = router;
