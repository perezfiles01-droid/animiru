/**
 * Handing a refused request back to the device.
 *
 * Extensions run on the Animiru server, so every request comes from a
 * hosting provider's address - which is what sites with bot protection
 * block, whatever headers it carries. KickAssAnime answered 403 in 148ms to
 * a request that already looked like Chrome's. The user's phone is not
 * blocked, because it is not a datacenter.
 *
 * So a refusal stops the run and names the request; the app makes that one
 * request itself and runs the method again with the answer supplied.
 */

const { runExtension } = require('../extensions');
const { DeviceFetchRequired, requestKey } = require('../extensions/handoff');
const http = require('../extensions/http');

const CODE = `
  const mangayomiSources = [{ name: 'Blocked', id: 1, version: '1.0.0', baseUrl: 'https://site.test' }];
  class DefaultExtension extends MProvider {
    async getPopular(page) {
      const res = await new Client().get('https://site.test/api/list');
      return { list: JSON.parse(res.body).map((name) => ({ name, link: name })), hasNextPage: false };
    }
    async search(query) {
      const res = await new Client().post(
        'https://site.test/api/search', { 'Content-Type': 'application/json' },
        JSON.stringify({ query })
      );
      return { list: JSON.parse(res.body), hasNextPage: false };
    }
    getSourcePreferences() { return []; }
  }
`;

/** A source that swallows the failure and returns a thinner answer. */
const SWALLOWING_CODE = `
  const mangayomiSources = [{ name: 'Quiet', id: 2, version: '1.0.0', baseUrl: 'https://site.test' }];
  class DefaultExtension extends MProvider {
    async getPopular(page) {
      try {
        await new Client().get('https://site.test/api/list');
      } catch (err) {
        return { list: [], hasNextPage: false };
      }
      return { list: [{ name: 'never', link: 'never' }], hasNextPage: false };
    }
    getSourcePreferences() { return []; }
  }
`;

const refuse = (status) => jest.spyOn(http, 'request').mockResolvedValue({
  statusCode: status, headers: {}, url: 'https://site.test/api/list', body: ''
});

const run = (options) => runExtension({
  code: CODE, method: 'getPopular', args: [1], allowHandoff: true, ...options
});

afterEach(() => jest.restoreAllMocks());

describe('when the site refuses the server', () => {
  it.each([403, 429, 503])('asks the device to make the request (%i)', async (status) => {
    refuse(status);
    await expect(run({})).rejects.toBeInstanceOf(DeviceFetchRequired);
  });

  it('names the exact request, so the device can repeat it', async () => {
    refuse(403);

    const err = await run({}).catch((caught) => caught);
    expect(err.request).toMatchObject({ method: 'GET', url: 'https://site.test/api/list' });
    expect(err.statusCode).toBe(403);
  });

  // A source is free to catch a failed request and carry on - several do,
  // falling back to another server. A run that continued past a refusal
  // would return half an answer and look like a working source.
  it('is not swallowed by a source that catches the failure', async () => {
    refuse(403);

    await expect(runExtension({
      code: SWALLOWING_CODE, method: 'getPopular', args: [1], allowHandoff: true
    })).rejects.toBeInstanceOf(DeviceFetchRequired);
  });

  // A 404 is an answer about the URL, and a 500 is the site being broken.
  // Neither is about who is asking, so neither is worth a device round trip.
  it.each([404, 500, 200])('does not hand off a %i, which is an answer', async (status) => {
    jest.spyOn(http, 'request').mockResolvedValue({
      statusCode: status, headers: {}, url: 'u', body: '["a"]'
    });

    await expect(run({})).resolves.toBeDefined();
  });

  // On the web there is no device to hand anything to, and pretending
  // otherwise would turn a plain 403 into an instruction nobody can follow.
  it('refuses nothing when the caller cannot fetch for us', async () => {
    refuse(403);

    // An ordinary failure, reported as one - not an instruction to fetch
    // from a device that does not exist.
    const err = await runExtension({ code: CODE, method: 'getPopular', args: [1] })
      .catch((caught) => caught);

    expect(err).not.toBeInstanceOf(DeviceFetchRequired);
    expect(err.diagnostics).toBeTruthy();
  });
});

/**
 * The failure this whole mechanism was showing instead of fixing.
 *
 * The request the device is asked to make has to be named the way the
 * source names it. When it was named by the transport instead - after
 * redirects, after URL normalisation - the answer came back filed under a
 * name the replay never looked up, so the same request was refused every
 * round until the app ran out of rounds and put "The site refused the
 * server with 403" on screen. Every source is affected, because every
 * source reaches the network through this one op.
 */
describe('naming the request so the replay can find it', () => {
  it('names the URL the source asked for, not the hop that answered', async () => {
    jest.spyOn(http, 'request').mockImplementation(async ({ url, onRequest }) => {
      // What the real transport does: reports each hop, normalised.
      onRequest({ method: 'GET', url: 'https://cdn.site.test/api/list?redirected=1' });
      return { statusCode: 403, headers: {}, url, body: '' };
    });

    const err = await run({}).catch((caught) => caught);
    expect(err.request.url).toBe('https://site.test/api/list');
  });

  it('finds the answer even when the two spellings differ', async () => {
    refuse(403);

    const outcome = await runExtension({
      code: CODE.replace("'https://site.test/api/list'", "'https://site.test/api/list'"),
      method: 'getPopular',
      args: [1],
      allowHandoff: true,
      // Stored under the trailing-slash-normalised spelling, as a URL that
      // has been through `new URL()` comes back.
      fetched: {
        [requestKey({ method: 'GET', url: 'https://site.test:443/api/list' })]: {
          statusCode: 200, body: '["One Piece"]', headers: {}, url: ''
        }
      }
    });

    expect(outcome.result.list[0].name).toBe('One Piece');
  });
});

describe('running again with what the device fetched', () => {
  const answered = (body) => ({
    [requestKey({ method: 'GET', url: 'https://site.test/api/list' })]: {
      statusCode: 200, body, headers: {}, url: 'https://site.test/api/list'
    }
  });

  it('completes the run from the device answer', async () => {
    refuse(403);

    const outcome = await run({ fetched: answered('["One Piece","Naruto"]') });
    expect(outcome.result.list.map((item) => item.name)).toEqual(['One Piece', 'Naruto']);
  });

  it('does not ask the network again for a request the device answered', async () => {
    const request = refuse(403);
    await run({ fetched: answered('["One Piece"]') });

    expect(request).not.toHaveBeenCalled();
  });

  it('records that the answer came from the device', async () => {
    refuse(403);

    const outcome = await run({ fetched: answered('["One Piece"]') });
    expect(outcome.requests[0]).toMatchObject({ viaDevice: true, status: 200 });
  });

  // The device answering one request does not make the whole run local:
  // anything the site did not refuse is still fetched by the server.
  it('leaves the other requests to the server', async () => {
    const request = jest.spyOn(http, 'request').mockImplementation(async ({ url }) => (
      url.includes('/api/list')
        ? { statusCode: 403, headers: {}, url, body: '' }
        : { statusCode: 200, headers: {}, url, body: '["other"]' }
    ));

    await runExtension({
      code: CODE.replace(
        "const res = await new Client().get('https://site.test/api/list');",
        "await new Client().get('https://site.test/api/other');"
        + " const res = await new Client().get('https://site.test/api/list');"
      ),
      method: 'getPopular',
      args: [1],
      allowHandoff: true,
      fetched: answered('["One Piece"]')
    });

    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0].url).toContain('/api/other');
  });

  // A body is part of what identifies a request: answering a search for
  // "bleach" with the result for "naruto" is worse than failing.
  it('does not answer one POST with the answer to another', async () => {
    jest.spyOn(http, 'request').mockResolvedValue({
      statusCode: 403, headers: {}, url: 'https://site.test/api/search', body: ''
    });

    const forNaruto = {
      [requestKey({
        method: 'POST',
        url: 'https://site.test/api/search',
        body: JSON.stringify({ query: 'naruto' })
      })]: { statusCode: 200, body: '[]', headers: {}, url: '' }
    };

    await expect(runExtension({
      code: CODE, method: 'search', args: ['bleach', 1, []],
      allowHandoff: true, fetched: forNaruto
    })).rejects.toBeInstanceOf(DeviceFetchRequired);
  });

  it('answers the POST it was actually given', async () => {
    jest.spyOn(http, 'request').mockResolvedValue({
      statusCode: 403, headers: {}, url: 'https://site.test/api/search', body: ''
    });

    const outcome = await runExtension({
      code: CODE, method: 'search', args: ['bleach', 1, []],
      allowHandoff: true,
      fetched: {
        [requestKey({
          method: 'POST',
          url: 'https://site.test/api/search',
          body: JSON.stringify({ query: 'bleach' })
        })]: { statusCode: 200, body: '[{"name":"Bleach"}]', headers: {}, url: '' }
      }
    });

    expect(outcome.result.list).toEqual([{ name: 'Bleach' }]);
  });

  // The site refusing the user's own connection too is an answer, not a
  // reason to ask the device again - that would loop.
  it('does not ask again when the device was refused as well', async () => {
    refuse(403);

    const outcome = await run({
      fetched: {
        [requestKey({ method: 'GET', url: 'https://site.test/api/list' })]: {
          statusCode: 403, body: '[]', headers: {}, url: ''
        }
      }
    }).catch((err) => err);

    expect(outcome).not.toBeInstanceOf(DeviceFetchRequired);
  });
});

/**
 * A site that refuses without spending a response on it.
 *
 * Answering 403 is the polite way to turn a datacenter away. The cheaper way
 * is to drop the connection - hang until it times out, reset it, or close it
 * mid-handshake - and plenty of sites do exactly that. AniNeko gave no
 * answer in fifteen seconds across two attempts; a subtitle host closed the
 * socket before TLS finished. Neither produced a response, so neither
 * reached isRefusal, and the device that could have fetched them was never
 * asked.
 *
 * This is the one op every source reaches the network through, so what is
 * asserted here holds for all of them.
 */
describe('when the site refuses without answering', () => {
  const failWith = (message) => jest.spyOn(http, 'request')
    .mockRejectedValue(new Error(message));

  it.each([
    ['a request that timed out', 'timeout of 5679ms exceeded'],
    ['a connection reset', 'read ECONNRESET'],
    ['a socket hung up', 'socket hang up'],
    ['a connection closed mid-TLS',
      'Client network socket disconnected before secure TLS connection was established'],
    ['the transport giving up', 'Request timed out']
  ])('hands %s to the device', async (_, message) => {
    failWith(message);
    await expect(run({})).rejects.toBeInstanceOf(DeviceFetchRequired);
  });

  it('names the request the device has to make', async () => {
    failWith('timeout of 5679ms exceeded');

    const err = await run({}).catch((caught) => caught);
    expect(err.request).toMatchObject({ method: 'GET', url: 'https://site.test/api/list' });
    // No status: the site never sent one. Saying 0 or 403 would be a lie
    // about what happened.
    expect(err.statusCode).toBeNull();
    expect(err.message).toMatch(/did not answer/);
  });

  /*
   * These are answers about the request rather than about who is asking.
   * The device would fail them identically, so handing one over spends a
   * round trip - and four rounds of them - to learn what we already knew.
   */
  it.each([
    ['a host that does not resolve', 'getaddrinfo ENOTFOUND anineko.to'],
    ['a refused connection', 'connect ECONNREFUSED 1.2.3.4:443'],
    ['an unusable URL', 'Invalid URL: undefined/api'],
    ['a private address', 'Refusing to fetch a private address: 10.0.0.1']
  ])('does not hand off %s', async (_, message) => {
    failWith(message);

    const err = await run({}).catch((caught) => caught);
    expect(err).not.toBeInstanceOf(DeviceFetchRequired);
  });

  // On the web there is no device, and an instruction nobody can follow is
  // worse than the plain error.
  it('stays a plain failure when the caller cannot fetch for us', async () => {
    failWith('timeout of 5679ms exceeded');

    const err = await runExtension({ code: CODE, method: 'getPopular', args: [1] })
      .catch((caught) => caught);

    expect(err).not.toBeInstanceOf(DeviceFetchRequired);
    expect(err.diagnostics).toBeTruthy();
  });

  // The device's answer completes the run exactly as it does for a 403.
  it('completes the run once the device answers', async () => {
    failWith('timeout of 5679ms exceeded');

    const outcome = await run({
      fetched: {
        [requestKey({ method: 'GET', url: 'https://site.test/api/list' })]: {
          statusCode: 200, body: '["One Piece"]', headers: {}, url: ''
        }
      }
    });

    expect(outcome.result.list[0].name).toBe('One Piece');
  });
});


/**
 * Answering every refused request in one round.
 *
 * A run was assumed to hit one refusal. Sources fan out - AniLight asks
 * several backends for one episode, in parallel - and a site that refuses
 * the server refuses all of them. Carrying one answer per replay meant a run
 * needing a dozen needed a dozen rounds, against an app that allows four:
 * the refusal reached the user with the fix working exactly as built.
 */
describe('everything a run wants the device to make', () => {
  const FANOUT = `
    const mangayomiSources = [{ name: 'Fanout', id: 3, version: '1.0.0', baseUrl: 'https://site.test' }];
    class DefaultExtension extends MProvider {
      async getVideoList(id) {
        const urls = ['/a', '/b', '/c'];
        const bodies = await Promise.all(urls.map((path) =>
          new Client().get('https://site.test' + path).then((r) => r.body).catch(() => '')
        ));
        return bodies.filter(Boolean).map((body) => ({ url: body, quality: '1080p' }));
      }
      getSourcePreferences() { return []; }
    }
  `;

  afterEach(() => jest.restoreAllMocks());

  const refuseAll = () => jest.spyOn(http, 'request').mockImplementation(async ({ url }) => ({
    statusCode: 403, headers: {}, url, body: ''
  }));

  const run = (fetched) => runExtension({
    code: FANOUT, method: 'getVideoList', args: ['/e/1'], allowHandoff: true, fetched
  });

  it('names every request that was refused, not only the first', async () => {
    refuseAll();

    const err = await run().catch((caught) => caught);
    expect(err.alsoWanted.map((request) => request.url)).toEqual([
      'https://site.test/a', 'https://site.test/b', 'https://site.test/c'
    ]);
  });

  it('leads with the one the message describes', async () => {
    refuseAll();

    const err = await run().catch((caught) => caught);
    expect(err.alsoWanted[0].url).toBe(err.request.url);
  });

  /**
   * The same address refused in two jobs is one request, not two.
   *
   * Written against a source that really does ask twice: three different
   * URLs can never collide, so a fixture using those would pass whether or
   * not anything deduplicated.
   */
  it('does not ask twice for the same request', async () => {
    const REPEATS = FANOUT.replace(
      "const urls = ['/a', '/b', '/c'];",
      "const urls = ['/a', '/a', '/b'];"
    );

    refuseAll();

    const err = await runExtension({
      code: REPEATS, method: 'getVideoList', args: ['/e/1'], allowHandoff: true
    }).catch((caught) => caught);

    expect(err.alsoWanted.map((request) => request.url))
      .toEqual(['https://site.test/a', 'https://site.test/b']);
  });

  it('finishes in one more round once they are all answered', async () => {
    refuseAll();

    const err = await run().catch((caught) => caught);
    const answers = {};
    err.alsoWanted.forEach((request, index) => {
      answers[requestKey(request)] = {
        statusCode: 200, body: `https://cdn.test/${index}.m3u8`, headers: {}, url: ''
      };
    });

    const outcome = await run(answers);
    expect(outcome.result.map((video) => video.url)).toEqual([
      'https://cdn.test/0.m3u8', 'https://cdn.test/1.m3u8', 'https://cdn.test/2.m3u8'
    ]);
  });

  // A run with one refusal must behave exactly as it did before.
  it('names just the one when only one was refused', async () => {
    jest.spyOn(http, 'request').mockImplementation(async ({ url }) => (
      url.endsWith('/b')
        ? { statusCode: 403, headers: {}, url, body: '' }
        : { statusCode: 200, headers: {}, url, body: 'https://cdn.test/ok.m3u8' }
    ));

    const err = await run().catch((caught) => caught);
    expect(err.alsoWanted).toHaveLength(1);
    expect(err.alsoWanted[0].url).toBe('https://site.test/b');
  });
});
