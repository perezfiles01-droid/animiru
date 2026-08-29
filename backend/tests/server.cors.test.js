/**
 * Which origins may call this API.
 *
 * The installed Android app is the case worth pinning: it is served from
 * WebViewAssetLoader's origin, not from a website, so if that origin is not
 * allowed the phone can install a source and never play anything from it -
 * and the failure appears in the browser layer, before any route runs, which
 * makes it look like the backend is down rather than misconfigured.
 */

const request = require('supertest');

const ANDROID_ORIGIN = 'https://appassets.androidplatform.net';

describe('CORS', () => {
  let app;

  beforeEach(() => {
    jest.resetModules();
    process.env.FRONTEND_URL = 'https://animiru.example';
    ({ app } = require('../server'));
  });

  it('allows the Android app origin', async () => {
    const res = await request(app)
      .get('/api/extensions/methods')
      .set('Origin', ANDROID_ORIGIN);

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(ANDROID_ORIGIN);
  });

  it('allows the configured web frontend', async () => {
    const res = await request(app)
      .get('/api/extensions/methods')
      .set('Origin', 'https://animiru.example');

    expect(res.headers['access-control-allow-origin']).toBe('https://animiru.example');
  });

  it('allows a request with no Origin, as health checks send', async () => {
    const res = await request(app).get('/api/extensions/methods');
    expect(res.status).toBe(200);
  });

  it('refuses an origin that is not ours, without erroring', async () => {
    const res = await request(app)
      .get('/api/extensions/methods')
      .set('Origin', 'https://evil.example');

    // No header means the browser blocks it. Answering normally keeps a
    // routine cross-origin probe out of the server's error log.
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.status).toBe(200);
  });

  it('answers the preflight the app sends before a POST', async () => {
    const res = await request(app)
      .options('/api/extensions/run')
      .set('Origin', ANDROID_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');

    expect(res.status).toBeLessThan(300);
    expect(res.headers['access-control-allow-origin']).toBe(ANDROID_ORIGIN);
  });
});

describe('serverless entry', () => {
  it('exports the app without binding a port', () => {
    jest.resetModules();
    const handler = require('../api/index');
    // An Express app is itself a request handler; a listening server is not.
    expect(typeof handler).toBe('function');
    expect(require('../server').server).toBeNull();
  });
});
