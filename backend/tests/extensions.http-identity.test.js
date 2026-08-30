/**
 * What an extension's request looks like on the wire.
 *
 * KickAssAnime answered 403 in 148ms with no page behind it, to a request
 * that already carried a full Chrome User-Agent. That is not a source asking
 * for the wrong thing - it is bot protection rejecting a request whose shape
 * no browser produces: a Chrome UA with no Accept-Language, no Sec-Fetch
 * metadata and no client hints is a contradiction, and the cheapest tier of
 * every bot check tests exactly that.
 */

jest.mock('axios');

const axios = require('axios');
const dns = require('dns').promises;
const { withBrowserIdentity, request } = require('../extensions/http');

describe('completing a browser request', () => {
  it('sends the client hints a Chrome UA implies', () => {
    const headers = withBrowserIdentity({});

    expect(headers['User-Agent']).toMatch(/Chrome\/\d+/);
    expect(headers['Accept-Language']).toBeTruthy();
    expect(headers['sec-ch-ua']).toContain('Google Chrome');
    expect(headers['sec-ch-ua-mobile']).toBe('?0');
    expect(headers['sec-ch-ua-platform']).toBe('"Windows"');
  });

  it('claims the same Chrome version in the UA and the hints', () => {
    const headers = withBrowserIdentity({});
    const [, version] = headers['User-Agent'].match(/Chrome\/(\d+)/);

    // Disagreeing with itself is the same tell as omitting them.
    expect(headers['sec-ch-ua']).toContain(`"Google Chrome";v="${version}"`);
  });

  describe('leaving a source in charge of what it set', () => {
    it('keeps a User-Agent the source chose', () => {
      const headers = withBrowserIdentity({ 'User-Agent': 'Mangayomi/1.0' });
      expect(headers['User-Agent']).toBe('Mangayomi/1.0');
    });

    // A source that lowercased its header has still set it; filling it in
    // again would put two User-Agents on the request.
    it('recognises a header the source spelled in another case', () => {
      const headers = withBrowserIdentity({ 'user-agent': 'Mangayomi/1.0' });

      expect(headers['user-agent']).toBe('Mangayomi/1.0');
      expect(headers['User-Agent']).toBeUndefined();
    });

    it('keeps a Referer, which many hosts require exactly', () => {
      const headers = withBrowserIdentity({ Referer: 'https://site.test/' });
      expect(headers.Referer).toBe('https://site.test/');
    });
  });

  describe('Sec-Fetch, which describes why the request is being made', () => {
    it('calls a bare GET a navigation, as a browser does', () => {
      const headers = withBrowserIdentity({}, { method: 'GET' });

      expect(headers['Sec-Fetch-Mode']).toBe('navigate');
      expect(headers['Sec-Fetch-Dest']).toBe('document');
      expect(headers['Upgrade-Insecure-Requests']).toBe('1');
    });

    // A JSON API call is a script's fetch(), and a browser never sends
    // Sec-Fetch-Mode: navigate for one. Getting it the wrong way round is
    // itself the inconsistency these checks look for.
    it('calls a JSON request a script fetch', () => {
      const headers = withBrowserIdentity({ Accept: 'application/json' });

      expect(headers['Sec-Fetch-Mode']).toBe('cors');
      expect(headers['Sec-Fetch-Dest']).toBe('empty');
      expect(headers['Upgrade-Insecure-Requests']).toBeUndefined();
    });

    it('treats a request from a page as same-origin', () => {
      const headers = withBrowserIdentity({ Referer: 'https://site.test/' });
      expect(headers['Sec-Fetch-Site']).toBe('same-origin');
    });

    it('treats a POST as a fetch too, whatever it asks for', () => {
      const headers = withBrowserIdentity({}, { method: 'POST' });
      expect(headers['Sec-Fetch-Mode']).toBe('cors');
    });
  });

  it('asks for HTML when the source did not say what it wanted', () => {
    expect(withBrowserIdentity({}).Accept).toContain('text/html');
  });

  it('does not override an Accept the source chose', () => {
    expect(withBrowserIdentity({ Accept: 'application/json' }).Accept)
      .toBe('application/json');
  });
});

/**
 * Building the headers correctly is worth nothing if the request does not
 * carry them, so this pins the wiring rather than the shape.
 */
describe('what actually goes out on the wire', () => {
  beforeEach(() => {
    jest.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    axios.mockReset();
    axios.mockResolvedValue({ status: 200, data: 'ok', headers: {} });
  });

  afterEach(() => jest.restoreAllMocks());

  const send = (options) => request({ url: 'https://site.test/page', ...options });

  it('carries the completed identity', async () => {
    await send({});

    const [sent] = axios.mock.calls[0];
    expect(sent.headers['Accept-Language']).toBeTruthy();
    expect(sent.headers['Sec-Fetch-Mode']).toBe('navigate');
  });

  it('still lets the source override it', async () => {
    await send({ headers: { 'User-Agent': 'Mangayomi/1.0' } });

    expect(axios.mock.calls[0][0].headers['User-Agent']).toBe('Mangayomi/1.0');
  });

  // The second tier of bot protection fingerprints the TLS handshake, which
  // no header can disguise. Node's cipher order is one no browser sends.
  it('hands axios an agent with a browser cipher order', async () => {
    await send({});

    const { httpsAgent } = axios.mock.calls[0][0];
    expect(httpsAgent).toBeDefined();
    expect(httpsAgent.options.ciphers).toContain('TLS_AES_128_GCM_SHA256');
    expect(httpsAgent.options.sigalgs).toContain('ecdsa_secp256r1_sha256');
    expect(httpsAgent.options.minVersion).toBe('TLSv1.2');
  });

  it('does not let an extension smuggle a Host header past the identity', async () => {
    await send({ headers: { Host: 'internal.test' } });

    expect(axios.mock.calls[0][0].headers.Host).toBeUndefined();
  });
});
