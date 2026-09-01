const express = require('express');
const router = express.Router();
const { buildInfo } = require('../build-info');

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
    build: buildInfo()
  });
});

// The router is the export, because server.js hands it straight to
// app.use and a router is a function. `build` rides along on it so tests
// can read it without a second module.
router.build = buildInfo;

module.exports = router;
