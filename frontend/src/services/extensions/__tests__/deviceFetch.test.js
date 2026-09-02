/**
 * The bridge that lets the app fetch a request the server was refused.
 *
 * KickAssAnime answered the server 403 in 148ms - bot protection turning
 * away a hosting provider's address, which no header or TLS change fixes.
 * The device is on an ordinary connection and is not refused.
 */

import { fetchOnDevice, isAvailable } from '../deviceFetch';

/** Stands in for the native object MainActivity injects. */
function installBridge(handler) {
  window.AnimiruDeviceFetch = {
    isAvailable: () => true,
    request: jest.fn((id, json) => handler(id, JSON.parse(json)))
  };
  return window.AnimiruDeviceFetch;
}

/** Answers as the native side does, by calling into the page. */
const answer = (id, payload) => window.__animiruDeviceFetch.deliver(id, JSON.stringify(payload));

afterEach(() => {
  delete window.AnimiruDeviceFetch;
  delete window.__animiruDeviceFetch;
});

describe('knowing whether this build can fetch', () => {
  it('is false in a browser, where there is no bridge', () => {
    expect(isAvailable()).toBe(false);
  });

  it('is true in the app', () => {
    installBridge(() => {});
    expect(isAvailable()).toBe(true);
  });

  // An older shell may inject the object without the method.
  it('is false when the bridge is there but cannot fetch', () => {
    window.AnimiruDeviceFetch = { request: () => {}, isAvailable: () => false };
    expect(isAvailable()).toBe(false);
  });

  it('is false when asking the bridge throws', () => {
    window.AnimiruDeviceFetch = {
      request: () => {},
      isAvailable: () => { throw new Error('gone'); }
    };
    expect(isAvailable()).toBe(false);
  });
});

describe('fetching one request', () => {
  it('sends the request the server named', async () => {
    const bridge = installBridge((id) => answer(id, { ok: true, statusCode: 200, body: 'hi' }));

    await fetchOnDevice({
      url: 'https://kaa.to/api/show/popular',
      method: 'GET',
      headers: { Referer: 'https://kaa.to/' }
    });

    const [, json] = bridge.request.mock.calls[0];
    expect(JSON.parse(json)).toMatchObject({
      url: 'https://kaa.to/api/show/popular',
      method: 'GET',
      headers: { Referer: 'https://kaa.to/' }
    });
  });

  it('returns the response in the shape the backend expects back', async () => {
    installBridge((id) => answer(id, {
      ok: true, statusCode: 200, body: '{"result":[]}', url: 'https://kaa.to/x'
    }));

    expect(await fetchOnDevice({ url: 'https://kaa.to/x' })).toEqual({
      statusCode: 200, body: '{"result":[]}', headers: {}, url: 'https://kaa.to/x'
    });
  });

  // The site refusing the user's connection too is an answer, and the run
  // has to see it rather than retry for ever.
  it('returns a refusal rather than throwing on one', async () => {
    installBridge((id) => answer(id, { ok: true, statusCode: 403, body: 'blocked' }));

    const response = await fetchOnDevice({ url: 'https://kaa.to/x' });
    expect(response.statusCode).toBe(403);
  });

  it('fails with what the device said went wrong', async () => {
    installBridge((id) => answer(id, { ok: false, error: 'Unable to resolve host' }));

    await expect(fetchOnDevice({ url: 'https://gone.test/' }))
      .rejects.toThrow(/Unable to resolve host/);
  });

  it('answers each request with its own reply', async () => {
    const pending = [];
    installBridge((id, request) => pending.push({ id, request }));

    const first = fetchOnDevice({ url: 'https://kaa.to/one' });
    const second = fetchOnDevice({ url: 'https://kaa.to/two' });

    // Delivered out of order, as two requests of different sizes would be.
    answer(pending[1].id, { ok: true, statusCode: 200, body: 'two' });
    answer(pending[0].id, { ok: true, statusCode: 200, body: 'one' });

    expect((await first).body).toBe('one');
    expect((await second).body).toBe('two');
  });

  it('ignores an answer to a request that is no longer waiting', () => {
    installBridge(() => {});
    fetchOnDevice({ url: 'https://kaa.to/x' });

    expect(() => answer('nobody', { ok: true, statusCode: 200, body: '' })).not.toThrow();
  });

  it('says so plainly when there is no bridge at all', async () => {
    await expect(fetchOnDevice({ url: 'https://kaa.to/x' }))
      .rejects.toThrow(/cannot fetch from the device/);
  });

  it('does not hang for ever when the device never answers', async () => {
    jest.useFakeTimers();
    installBridge(() => {});

    const pending = fetchOnDevice({ url: 'https://kaa.to/x' });
    const settled = pending.catch((err) => err);
    jest.advanceTimersByTime(31000);

    expect((await settled).message).toMatch(/took too long/);
    jest.useRealTimers();
  });
});


/**
 * Running a browser check instead of fetching it.
 *
 * The plain path moves bytes and executes nothing, so asking it for a check
 * returns the check. The shell has a browser; this is how it is reached.
 */
describe('solving a browser check', () => {
  function installSolver(handler) {
    window.AnimiruDeviceFetch = {
      isAvailable: () => true,
      request: jest.fn(),
      solve: jest.fn((id, json) => handler(id, JSON.parse(json)))
    };
    return window.AnimiruDeviceFetch;
  }

  const answer = (id, payload) =>
    window.__animiruDeviceFetch.deliver(id, JSON.stringify(payload));

  it('uses the browser for a challenge', async () => {
    const bridge = installSolver((id) => answer(id, {
      ok: true, statusCode: 200, body: '<html>the page</html>', solved: true
    }));

    const response = await fetchOnDevice({ url: 'https://kaa.to/x' }, { challenge: true });

    expect(bridge.solve).toHaveBeenCalled();
    expect(bridge.request).not.toHaveBeenCalled();
    expect(response.body).toBe('<html>the page</html>');
  });

  it('uses the plain path for anything else', async () => {
    const bridge = installSolver(() => {});
    bridge.request = jest.fn((id) => answer(id, { ok: true, statusCode: 200, body: 'x' }));

    await fetchOnDevice({ url: 'https://kaa.to/x' });

    expect(bridge.request).toHaveBeenCalled();
    expect(bridge.solve).not.toHaveBeenCalled();
  });

  // A shell too old to have a browser falls back to fetching, which returns
  // the check and fails - exactly what it did before this existed.
  it('falls back to fetching on a shell with no solver', async () => {
    window.AnimiruDeviceFetch = {
      isAvailable: () => true,
      request: jest.fn((id) => answer(id, { ok: true, statusCode: 200, body: 'check' }))
    };

    const response = await fetchOnDevice({ url: 'https://kaa.to/x' }, { challenge: true });

    expect(window.AnimiruDeviceFetch.request).toHaveBeenCalled();
    expect(response.body).toBe('check');
  });

  it('says so when the check does not clear', async () => {
    jest.useFakeTimers();
    installSolver(() => {});

    const pending = fetchOnDevice({ url: 'https://kaa.to/x' }, { challenge: true });
    const settled = pending.catch((err) => err);
    jest.advanceTimersByTime(36000);

    expect((await settled).message).toMatch(/browser check/);
    jest.useRealTimers();
  });

  // A check spins for several seconds by design; giving it a fetch's
  // deadline would abandon it while the browser was still working.
  it('waits longer for a check than for a fetch', async () => {
    jest.useFakeTimers();
    installSolver(() => {});

    const pending = fetchOnDevice({ url: 'https://kaa.to/x' }, { challenge: true });
    const settled = pending.catch((err) => err);

    jest.advanceTimersByTime(31000);
    await Promise.resolve();
    jest.advanceTimersByTime(5000);

    expect((await settled).message).toMatch(/browser check/);
    jest.useRealTimers();
  });
});
