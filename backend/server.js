require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

/** The largest request body the app may post. See express.json below. */
const MAX_REQUEST_BODY = '16mb';

const app = express();

// Middleware
app.use(helmet());
app.use(compression());
/**
 * Origins allowed to call this API.
 *
 * The Android app is not a website: WebViewAssetLoader serves it from
 * https://appassets.androidplatform.net, so that origin has to be allowed
 * explicitly or every request from the installed app is refused by the
 * browser before it reaches a route. Extensions run here, so without it a
 * phone can install a source and never play anything from it.
 */
const ANDROID_APP_ORIGIN = 'https://appassets.androidplatform.net';

const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:3000',
  ANDROID_APP_ORIGIN
];

app.use(cors({
  origin(origin, callback) {
    // No Origin header at all: same-origin requests, curl, and the health
    // checks a host runs against a deployment. Nothing to refuse.
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);

    // Answer without the header rather than throwing. The browser blocks the
    // response either way, and throwing would turn a routine cross-origin
    // probe into a 500 with a stack trace in the server log.
    return callback(null, false);
  },
  credentials: true
}));
/**
 * Big enough for what the app actually sends back.
 *
 * The default is 100kb, which was survivable while a run handed the device
 * one refused request at a time - one page, usually just under. A round now
 * carries every refused request's answer at once, and several pages of
 * scraped HTML together are megabytes: the app got "request entity too
 * large" and the run it was trying to finish never ran.
 *
 * The ceiling matches what a single response may be (5MB, in
 * extensions/http.js) times a handful, and the app is held to the same
 * number so it cannot send something this will refuse.
 */
app.use(express.json({ limit: MAX_REQUEST_BODY }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP'
});
app.use(limiter);

// Routes
app.use('/api/extensions', require('./routes/extensions'));
app.use('/api/metadata', require('./routes/metadata'));
app.use('/api/health', require('./routes/health'));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 3001;

/**
 * Only bind a port when started directly.
 *
 * On a serverless host the platform imports this module and calls the
 * exported app per request; listening there wastes a port and, on some
 * hosts, throws. Running `node server.js` locally is unaffected.
 */
let server = null;
if (require.main === module) {
  server = app.listen(PORT, () => {
    console.log(`🚀 Animiru Backend running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

module.exports = { app, server };
module.exports.default = app;
