/**
 * Trying a stalled request a second time.
 *
 * AniNeko failed with "timeout of 14955ms exceeded" - not a broken source,
 * just a site that did not answer that once. Ending a whole run on a single
 * stalled connection makes every source on a slow host look broken, so a
 * failure that says nothing about the request is tried again before it is
 * reported.
 *
 * Every source reaches the network through this one function, so this is
 * the retry for all of them.
 */

jest.mock('axios');

const axios = require('axios');
const dns = require('dns').promises;
const { request, isTransient } = require('../extensions/http');

const ok = (body = 'page') => ({ status: 200, headers: {}, data: body });

const failWith = (code, message = code) => {
  const err = new Error(message);
  err.code = code;
  return err;
};

beforeEach(() => {
  axios.mockReset();
  jest.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34' }]);
});

afterEach(() => jest.restoreAllMocks());

describe('what counts as worth trying again', () => {
  it.each([
    ['ETIMEDOUT'], ['ECONNRESET'], ['ECONNABORTED'], ['EAI_AGAIN']
  ])('%s says nothing about the request', (code) => {
    expect(isTransient(failWith(code))).toBe(true);
  });

  it('recognises the wording axios uses for a timeout', () => {
    expect(isTransient(new Error('timeout of 14955ms exceeded'))).toBe(true);
    expect(isTransient(new Error('socket hang up'))).toBe(true);
  });

  // A refused connection and a name that does not exist are answers, not
  // bad luck. Repeating them spends the run's budget to learn nothing.
  it.each([['ECONNREFUSED'], ['ENOTFOUND']])('%s is an answer, not bad luck', (code) => {
    expect(isTransient(failWith(code))).toBe(false);
  });
});

describe('a request that stalls once', () => {
  it('is tried again and succeeds', async () => {
    axios
      .mockRejectedValueOnce(new Error('timeout of 14955ms exceeded'))
      .mockResolvedValueOnce(ok('<html>'));

    const response = await request({ url: 'https://anineko.test/list' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('<html>');
    expect(axios).toHaveBeenCalledTimes(2);
  });

  it('is tried exactly twice, not until the budget is gone', async () => {
    axios.mockRejectedValue(failWith('ECONNRESET', 'read ECONNRESET'));

    await expect(request({ url: 'https://anineko.test/list' })).rejects.toThrow(/ECONNRESET/);
    expect(axios).toHaveBeenCalledTimes(2);
  });

  // Both attempts have to fit the budget the caller is holding. A retry
  // that could double the wait pushes the run past the app's own deadline,
  // and a timeout reported by the app carries none of the diagnostics. The
  // budget is a deadline rather than a per-attempt allowance, so the first
  // attempt is given only part of it and the second is given whatever the
  // clock has actually left.
  it('holds back part of the budget for the second attempt', async () => {
    axios
      .mockRejectedValueOnce(new Error('timeout of 100ms exceeded'))
      .mockResolvedValueOnce(ok());

    await request({ url: 'https://anineko.test/list', timeoutMs: 10000 });

    const [first, second] = axios.mock.calls.map(([config]) => config.timeout);
    expect(first).toBeLessThan(10000);
    // The last attempt is bounded by the clock, not given a fresh budget.
    expect(second).toBeLessThanOrEqual(10000);
  });

  // Retrying inside the last moments of a budget cannot finish, and burns
  // the time that would have gone to reporting the failure.
  it('does not start a second attempt with no budget left', async () => {
    axios.mockRejectedValue(new Error('timeout of 5ms exceeded'));

    await expect(request({
      url: 'https://anineko.test/list', timeoutMs: 50
    })).rejects.toThrow();

    expect(axios).toHaveBeenCalledTimes(1);
  });
});

describe('what is not retried', () => {
  // Repeating a POST repeats whatever it did on the site.
  it('does not repeat a POST', async () => {
    axios.mockRejectedValue(new Error('socket hang up'));

    await expect(request({
      url: 'https://anineko.test/search', method: 'POST', body: '{}'
    })).rejects.toThrow();

    expect(axios).toHaveBeenCalledTimes(1);
  });

  it('does not repeat a request that was answered', async () => {
    axios.mockResolvedValue({ status: 404, headers: {}, data: 'gone' });

    const response = await request({ url: 'https://anineko.test/missing' });

    expect(response.statusCode).toBe(404);
    expect(axios).toHaveBeenCalledTimes(1);
  });

  it('does not repeat a failure that is an answer', async () => {
    axios.mockRejectedValue(failWith('ECONNREFUSED', 'connect ECONNREFUSED'));

    await expect(request({ url: 'https://anineko.test/list' })).rejects.toThrow();
    expect(axios).toHaveBeenCalledTimes(1);
  });
});
