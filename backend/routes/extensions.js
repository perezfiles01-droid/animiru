/**
 * The extension API.
 *
 * Sources are fetched, validated and executed on the server rather than in
 * the browser: extensions scrape sites that send no CORS headers, so running
 * them client-side would need a proxy anyway, and doing it here means the
 * web app, the PWA and the Android wrapper all behave identically.
 *
 * Which repositories a user has added and which sources they enabled is not
 * stored here - that lives on the client. The server holds no per-user
 * extension state at all; it fetches, it runs, it caches, and it forgets.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const repository = require('./../extensions/repository');
const { fetchSubtitle, SubtitleError } = require('./../extensions/subtitles');
const { runExtension, ExtensionError, CALLABLE_METHODS } = require('./../extensions');
const { DeviceFetchRequired, requestKey } = require('./../extensions/handoff');

/**
 * Running an extension means making outbound requests on a caller's behalf,
 * which is worth more than the app-wide limit allows.
 */
const extensionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many extension requests, slow down' }
});

router.use(extensionLimiter);

/** Turns an internal failure into something a user can act on. */
function fail(res, status, message, extra = {}) {
  return res.status(status).json({ error: message, ...extra });
}

/**
 * List the sources a repository offers.
 * POST /api/extensions/repository  { url }
 */
router.post('/repository', async (req, res, next) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return fail(res, 400, 'A repository URL is required');
  }

  try {
    const { repoUrl, sources, skipped } = await repository.fetchIndex(url);
    return res.json({ repoUrl, sources, skipped });
  } catch (err) {
    // A bad repository URL is the user's typo, not a server fault, so it
    // reads as a 400 with the reason rather than a 500.
    return fail(res, 400, `Could not read repository: ${err.message}`);
  }
});

/**
 * Fetch a source's code and the metadata it declares.
 * POST /api/extensions/source  { codeUrl, version, refresh }
 */
router.post('/source', async (req, res, next) => {
  const { codeUrl, version, refresh } = req.body || {};
  if (!codeUrl || typeof codeUrl !== 'string') {
    return fail(res, 400, 'A source code URL is required');
  }

  try {
    const fetched = await repository.fetchSourceCode(codeUrl, {
      version: typeof version === 'string' ? version : '0.0.0',
      refresh: Boolean(refresh)
    });
    return res.json(fetched);
  } catch (err) {
    return fail(res, 400, `Could not read source: ${err.message}`);
  }
});

/**
 * Run one method of one source.
 *
 * The caller supplies either a codeUrl to fetch, or code directly.
 *
 * POST /api/extensions/run
 *   { codeUrl | code, version, method, args, source, preferences }
 */
router.post('/run', async (req, res, next) => {
  const body = req.body || {};
  const { method, codeUrl, code } = body;

  if (!method || !CALLABLE_METHODS.has(method)) {
    return fail(res, 400, `Method must be one of: ${[...CALLABLE_METHODS].join(', ')}`);
  }
  if (!codeUrl && typeof code !== 'string') {
    return fail(res, 400, 'Either codeUrl or code is required');
  }
  if (body.args !== undefined && !Array.isArray(body.args)) {
    return fail(res, 400, 'args must be an array');
  }

  try {
    let source = body.source && typeof body.source === 'object' ? body.source : {};
    let extensionCode = code;

    if (codeUrl) {
      const fetched = await repository.fetchSourceCode(codeUrl, {
        version: typeof body.version === 'string' ? body.version : '0.0.0'
      });
      extensionCode = fetched.code;
      // The declaration in the file is the author's own description of the
      // source; the caller's entry only fills gaps it does not cover.
      source = { ...source, ...(fetched.sources[0] || {}) };
    }

    const outcome = await runExtension({
      code: extensionCode,
      method,
      args: body.args || [],
      source,
      preferences: body.preferences && typeof body.preferences === 'object'
        ? body.preferences
        : {},
      // A caller says whether it can make a request itself. Only the app can
      // - it has a real browser on the user's own connection - and only it
      // sends these two.
      allowHandoff: Boolean(body.allowHandoff),
      fetched: body.fetched && typeof body.fetched === 'object' ? body.fetched : undefined
    });

    return res.json(outcome);
  } catch (err) {
    // Not a failure: the site refused this server, and the run can finish if
    // the caller makes this one request from its own connection and asks
    // again with the answer. 409 rather than an error status because there
    // is something specific to do about it.
    if (err instanceof DeviceFetchRequired) {
      return res.status(409).json({
        error: err.message,
        needsDeviceFetch: {
          key: requestKey(err.request),
          request: err.request,
          refusedWith: err.statusCode
        }
      });
    }

    if (err instanceof ExtensionError) {
      // A failed run is worth more than its message: the diagnostics say
      // where in the source it broke, what that usually means, and what the
      // source asked for on the way there.
      return fail(res, 422, err.message, {
        logs: err.logs,
        requests: err.requests,
        diagnostics: err.diagnostics
      });
    }
    return next(err);
  }
});

/**
 * Serve a subtitle file to the player.
 *
 * A browser refuses a cross-origin <track> unless the host sends CORS
 * headers, and a subtitle host has no reason to. The file arrives here, is
 * converted to WebVTT if it is SubRip, and goes out with headers a <track>
 * will accept.
 *
 * GET /api/extensions/subtitle?url=...&referer=...
 */
router.get('/subtitle', async (req, res, next) => {
  const { url, referer } = req.query;

  if (!url || typeof url !== 'string') {
    return fail(res, 400, 'A subtitle URL is required');
  }

  try {
    const { vtt } = await fetchSubtitle(url, referer ? { Referer: referer } : undefined);

    res.set('Content-Type', 'text/vtt; charset=utf-8');
    // Subtitles for a given episode do not change, and refetching one on
    // every seek would be wasteful.
    res.set('Cache-Control', 'public, max-age=3600');
    return res.send(vtt);
  } catch (err) {
    if (err instanceof SubtitleError) {
      return fail(res, err.status, err.message);
    }
    return next(err);
  }
});

/**
 * The methods a source may expose, so the client does not keep its own copy
 * of the list.
 * GET /api/extensions/methods
 */
router.get('/methods', (req, res) => {
  res.json({ methods: [...CALLABLE_METHODS] });
});

module.exports = router;
