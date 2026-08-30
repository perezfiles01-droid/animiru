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

  it('reports both failures when the device cannot fetch it either', async () => {
    api.post.mockRejectedValue(refusal());
    fetchOnDevice.mockRejectedValue(new Error('Unable to resolve host'));

    await expect(runSource({ method: 'getPopular', args: [1] }))
      .rejects.toThrow(/refused the server.*Unable to resolve host/s);
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
