/**
 * Finishing a run the site refused the server for.
 *
 * The backend answers 409 with the one request it could not make; the app
 * makes it from the device and asks again with the answer. This is the loop
 * that turns "The site refused the request with 403" into a working source.
 */

import api from '../../api';
import { runSource } from '../client';
import { fetchOnDevice, isAvailable } from '../deviceFetch';

jest.mock('../../api', () => ({ post: jest.fn(), defaults: { baseURL: '' } }));
jest.mock('../deviceFetch', () => ({
  fetchOnDevice: jest.fn(),
  isAvailable: jest.fn()
}));

const REQUEST = { method: 'GET', url: 'https://kaa.to/api/show/popular', headers: {} };
const KEY = 'GET https://kaa.to/api/show/popular';

/** The 409 the backend sends when it is turned away. */
const refusal = () => {
  const err = new Error('Request failed with status code 409');
  err.response = {
    status: 409,
    data: {
      error: 'The site refused the server with 403.',
      needsDeviceFetch: { key: KEY, request: REQUEST, refusedWith: 403 }
    }
  };
  return err;
};

const ran = { data: { result: { list: [{ name: 'One Piece' }] }, logs: [], requests: [] } };

beforeEach(() => {
  api.post.mockReset();
  fetchOnDevice.mockReset();
  isAvailable.mockReturnValue(true);
});

describe('when the backend is refused', () => {
  it('fetches the named request on the device and runs again', async () => {
    api.post.mockRejectedValueOnce(refusal()).mockResolvedValueOnce(ran);
    fetchOnDevice.mockResolvedValue({ statusCode: 200, body: '[]', headers: {}, url: '' });

    const outcome = await runSource({ method: 'getPopular', args: [1] });

    expect(fetchOnDevice).toHaveBeenCalledWith(REQUEST);
    expect(outcome.result.list).toEqual([{ name: 'One Piece' }]);
  });

  it('sends the answer back under the key it was given', async () => {
    api.post.mockRejectedValueOnce(refusal()).mockResolvedValueOnce(ran);
    const response = { statusCode: 200, body: '[]', headers: {}, url: '' };
    fetchOnDevice.mockResolvedValue(response);

    await runSource({ method: 'getPopular', args: [1] });

    expect(api.post.mock.calls[1][1].fetched).toEqual({ [KEY]: response });
  });

  // Each round is a full replay, so answers have to accumulate; dropping
  // the earlier ones would refuse the same request again for ever.
  it('keeps the earlier answers when a second request is refused', async () => {
    const second = { ...refusal() };
    second.response = {
      status: 409,
      data: {
        error: 'refused',
        needsDeviceFetch: {
          key: 'GET https://kaa.to/api/show/one-piece',
          request: { method: 'GET', url: 'https://kaa.to/api/show/one-piece' }
        }
      }
    };

    api.post
      .mockRejectedValueOnce(refusal())
      .mockRejectedValueOnce(second)
      .mockResolvedValueOnce(ran);
    fetchOnDevice.mockResolvedValue({ statusCode: 200, body: '[]', headers: {}, url: '' });

    await runSource({ method: 'getPopular', args: [1] });

    expect(Object.keys(api.post.mock.calls[2][1].fetched)).toEqual([
      KEY, 'GET https://kaa.to/api/show/one-piece'
    ]);
  });

  it('gives up rather than looping when every round is refused', async () => {
    api.post.mockRejectedValue(refusal());
    fetchOnDevice.mockResolvedValue({ statusCode: 403, body: '', headers: {}, url: '' });

    await expect(runSource({ method: 'getPopular', args: [1] })).rejects.toThrow();
    expect(api.post.mock.calls.length).toBeLessThanOrEqual(5);
  });

  // Both reasons are still reported - behind the summary rather than in
  // front of it, so the reader gets the conclusion first and the evidence
  // when they want it.
  it('keeps both failures when the device cannot fetch it either', async () => {
    api.post.mockRejectedValue(refusal());
    fetchOnDevice.mockRejectedValue(new Error('Unable to resolve host'));

    const err = await runSource({ method: 'getPopular', args: [1] })
      .catch((caught) => caught);

    expect(err.message).toMatch(/site is not answering/i);
    expect(err.diagnostics.attempts.server).toMatch(/refused the server/i);
    expect(err.diagnostics.attempts.device).toBe('Unable to resolve host');
  });
});

describe('what the backend is told about the caller', () => {
  it('offers to fetch when the app can', async () => {
    api.post.mockResolvedValue(ran);
    await runSource({ method: 'getPopular', args: [1] });

    expect(api.post.mock.calls[0][1].allowHandoff).toBe(true);
  });

  // On the web there is no device, and an instruction nobody can follow is
  // worse than the plain error.
  it('does not, on the web', async () => {
    isAvailable.mockReturnValue(false);
    api.post.mockResolvedValue(ran);
    await runSource({ method: 'getPopular', args: [1] });

    expect(api.post.mock.calls[0][1].allowHandoff).toBe(false);
  });
});

describe('an ordinary failure', () => {
  it('is still reported with its diagnostics', async () => {
    const err = new Error('boom');
    err.response = {
      status: 422,
      data: { error: 'Cannot read properties of null', diagnostics: { cause: 'A selector' } }
    };
    api.post.mockRejectedValue(err);

    const caught = await runSource({ method: 'getPopular', args: [1] }).catch((e) => e);
    expect(caught.message).toBe('Cannot read properties of null');
    expect(caught.diagnostics).toEqual({ cause: 'A selector' });
    expect(fetchOnDevice).not.toHaveBeenCalled();
  });
});

/**
 * When the server and the device both fail to reach a site.
 *
 * Two failures from two networks establish one thing: the site is not
 * answering anybody. The report used to put the two technical failures end
 * to end - "timeout of 5695ms exceeded ... Software caused connection abort"
 * - which reads as a chain of things going wrong inside the app. The one
 * fact it had actually established was the one it did not say.
 */
describe('when neither the server nor the device can reach the site', () => {
  const bothFail = async () => {
    api.post.mockRejectedValue(refusal());
    fetchOnDevice.mockRejectedValue(new Error('Software caused connection abort'));
    return runSource({ method: 'getPopular', args: [1] }).catch((err) => err);
  };

  it('says the site is not answering, not that something went wrong', async () => {
    const err = await bothFail();

    expect(err.message).toMatch(/site is not answering/i);
    expect(err.message).toMatch(/site itself is down/i);
  });

  // The two things a reader wrongly suspects first.
  it('rules out the app and the connection explicitly', async () => {
    const err = await bothFail();
    expect(err.message).toMatch(/rather than your connection or the app/i);
  });

  it('does not lead with the technical failures', async () => {
    const err = await bothFail();

    expect(err.message).not.toMatch(/Software caused connection abort/);
    expect(err.message).not.toMatch(/timeout of \d+ms/);
  });

  // Kept, but behind the summary rather than in front of it.
  it('keeps what each road reported, for the details panel', async () => {
    const err = await bothFail();

    expect(err.diagnostics.attempts.device).toBe('Software caused connection abort');
    expect(err.diagnostics.attempts.server).toMatch(/refused the server/i);
  });

  it('says other sources are unaffected', async () => {
    const err = await bothFail();
    expect(err.diagnostics.fix).toMatch(/Other sources are unaffected/i);
  });
});

/**
 * Remembering which of a source's homes worked.
 *
 * A source may name several domains running the same software, and the
 * backend keeps no per-user state. Without this, a source whose usual home
 * is down would fall through to a mirror on every screen, paying the failed
 * attempt each time.
 */
describe('the home a source last worked from', () => {
  const KEY = 'repo|Roaming';
  const withKey = (extra) => ({
    method: 'getPopular', args: [1], source: { key: KEY, name: 'Roaming' }, ...extra
  });

  beforeEach(() => {
    window.localStorage.clear();
  });

  it('is sent so the backend starts there', async () => {
    window.localStorage.setItem(
      'animiru.extensions.homes', JSON.stringify({ [KEY]: 'https://two.test' })
    );
    api.post.mockResolvedValue(ran);

    await runSource(withKey());

    expect(api.post.mock.calls[0][1].preferredBaseUrl).toBe('https://two.test');
  });

  it('is remembered from what the run reports', async () => {
    api.post.mockResolvedValue({ data: { ...ran.data, baseUrl: 'https://one.test' } });

    await runSource(withKey());

    expect(JSON.parse(window.localStorage.getItem('animiru.extensions.homes')))
      .toEqual({ [KEY]: 'https://one.test' });
  });

  it('is not sent when there is nothing remembered', async () => {
    api.post.mockResolvedValue(ran);
    await runSource(withKey());

    expect(api.post.mock.calls[0][1].preferredBaseUrl).toBeUndefined();
  });

  // Nothing to key it by, so nothing is stored - and the run still works.
  it('is skipped for a source with no key', async () => {
    api.post.mockResolvedValue({ data: { ...ran.data, baseUrl: 'https://one.test' } });

    const outcome = await runSource({ method: 'getPopular', args: [1] });

    expect(outcome.result).toBeTruthy();
    expect(window.localStorage.getItem('animiru.extensions.homes')).toBeNull();
  });
});

/**
 * Ruling out a home whose streams would not play.
 *
 * The player tries every server a home gave it. When none play, asking
 * that home again returns the same unplayable list - so the screen names
 * it and the backend rotation moves past it.
 */
describe('homes already found wanting', () => {
  it('are sent so the backend skips them', async () => {
    api.post.mockResolvedValue(ran);

    await runSource({
      method: 'getVideoList', args: ['ep-1'], excludeBaseUrls: ['https://home.test']
    });

    expect(api.post.mock.calls[0][1].excludeBaseUrls).toEqual(['https://home.test']);
  });

  // Sending an empty list would say "rule out nothing", which is what
  // omitting it already means - and the backend treats the two the same.
  it.each([[[]], [undefined], ['not a list']])('are omitted for %p', async (bad) => {
    api.post.mockResolvedValue(ran);

    await runSource({ method: 'getVideoList', args: ['ep-1'], excludeBaseUrls: bad });

    expect(api.post.mock.calls[0][1].excludeBaseUrls).toBeUndefined();
  });
});
