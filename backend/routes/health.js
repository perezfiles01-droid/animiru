const express = require('express');
const router = express.Router();

/**
 * Which build is answering.
 *
 * A screenshot of a failure cannot be read without this. Three times in a
 * row a fix was written, tested, pushed and reported - and the app went on
 * showing the failure, because the branch had never been merged and no
 * build had ever contained the fix. Nothing in the app or the API could
 * tell the two situations apart, so the same error was diagnosed three
 * times.
 *
 * Vercel sets these at build time from the commit it built. Locally there
 * is no commit to report, and "development" is the honest answer rather
 * than a guess.
 */
function build() {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA
    || process.env.GIT_COMMIT_SHA
    || '';

  return {
    commit: commit || 'unknown',
    // Enough to recognise, short enough to read out of a screenshot.
    shortCommit: commit ? commit.slice(0, 7) : 'unknown',
    branch: process.env.VERCEL_GIT_COMMIT_REF || process.env.GIT_BRANCH || 'unknown',
    builtAt: process.env.VERCEL_DEPLOYMENT_CREATED_AT || null
  };
}

/**
 * Health check endpoint
 * GET /api/health
 */
router.get('/', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    // What is actually deployed, so a failure can be attributed to a build.
    build: build()
  });
});

// The router is the export, because server.js hands it straight to
// app.use and a router is a function. `build` rides along on it so tests
// can read it without a second module.
router.build = build;

module.exports = router;
