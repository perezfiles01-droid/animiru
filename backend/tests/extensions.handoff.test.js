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
