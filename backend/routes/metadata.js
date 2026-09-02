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
    // A bad request from the app is the app's fault, not AniList's, and
    // reporting it as 502 would send someone looking at the wrong thing.
    res.status(err && err.status ? err.status : 502).json({
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

/**
 * One of the front page's rows. The name is checked against the known
 * charts rather than passed through, so this cannot be used to run an
 * arbitrary sort against AniList on our rate limit.
 */
router.get('/chart/:name', handle(async (req) => {
  const { name } = req.params;
  if (!Object.prototype.hasOwnProperty.call(anilist.CHARTS, name)) {
    const known = Object.keys(anilist.CHARTS).join(', ');
    throw Object.assign(new Error(`Unknown chart: ${name}. Try one of: ${known}`), {
      status: 400
    });
  }

  return anilist.getChart(name, { perPage: Number(req.query.perPage) || 20 });
}));

router.get('/watch-order', handle(async (req) => ({
  entries: await anilist.getWatchOrder(req.query.id)
})));

router.get('/recommendations', handle(async (req) => ({
  results: await anilist.getRecommendations(req.query.id)
})));

module.exports = router;
