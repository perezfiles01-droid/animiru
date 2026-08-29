/**
 * Serverless entry point.
 *
 * Vercel imports this and calls it once per request, so it must export the
 * Express app itself rather than a listening server. server.js only binds a
 * port when run directly, which is what makes the same file work both ways.
 */

const { app } = require('../server');

module.exports = app;
