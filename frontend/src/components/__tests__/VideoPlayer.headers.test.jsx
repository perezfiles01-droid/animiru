import { registerStreamHeaders, needsManagedHls } from '../VideoPlayer';

/**
 * Getting the Referer as far as the CDN.
 *
 * Sources have always known these headers and always sent them - a stream
 * option carries a Referer because the host serving it refuses a request
 * without one. Nothing used them for the video. They were attached to
 * subtitles, which go through a proxy, and dropped for the media, which
 * does not.
 *
 * The page cannot fix that itself, and this is not an oversight in the
 * browser: Referer and Origin are forbidden header names, so that a page
 * cannot claim to be somewhere it is not. The Android shell is native code
 * and is not bound by the rule, so it makes the request - but only for the
 * streams it has been told about, which is what these assert.
 */

const bridge = () => ({ register: jest.fn() });

afterEach(() => { delete window.AnimiruMediaHeaders; });

describe('telling the shell about a stream', () => {
  it('registers a stream whose host needs a referer', () => {
    window.AnimiruMediaHeaders = bridge();

    registerStreamHeaders([
      { url: 'https://bd.24stream.xyz/a.m3u8', headers: { Referer: 'https://anidap.lol/' } }
    ]);

    const sent = JSON.parse(window.AnimiruMediaHeaders.register.mock.calls[0][0]);
    expect(sent).toEqual([
      { url: 'https://bd.24stream.xyz/a.m3u8', headers: { Referer: 'https://anidap.lol/' } }
    ]);
  });

  it('does not register a stream that needs nothing', () => {
    window.AnimiruMediaHeaders = bridge();

    registerStreamHeaders([{ url: 'https://cdn.test/a.m3u8' }]);

    expect(JSON.parse(window.AnimiruMediaHeaders.register.mock.calls[0][0])).toEqual([]);
  });

  // Outside the app there is no shell. Playing must carry on regardless -
  // in a browser a hotlink-protected stream still will not play, but that
  // is the browser's limit, not a reason to fail before trying.
  it('says so, without throwing, when there is no shell', () => {
    expect(registerStreamHeaders([
      { url: 'https://cdn.test/a.m3u8', headers: { Referer: 'https://x.test/' } }
    ])).toBe(false);
  });

  it('does not fail playback when the shell rejects the registration', () => {
    window.AnimiruMediaHeaders = {
      register: () => { throw new Error('bridge is gone'); }
    };

    expect(() => registerStreamHeaders([
      { url: 'https://cdn.test/a.m3u8', headers: { Referer: 'https://x.test/' } }
    ])).not.toThrow();
  });

  it('tolerates being handed nothing at all', () => {
    window.AnimiruMediaHeaders = bridge();

    expect(() => registerStreamHeaders(undefined)).not.toThrow();
  });
});

describe('choosing hls.js over the platform', () => {
  it('takes hls.js when a stream needs headers, so the shell can add them', () => {
    window.AnimiruMediaHeaders = bridge();

    expect(needsManagedHls({
      type: 'hls', url: 'https://cdn.test/a.m3u8', headers: { Referer: 'https://x.test/' }
    })).toBe(true);
  });

  /*
   * Native playback keeps hardware decoding and is the better choice
   * whenever it can work. It is given up only to make a stream play at all,
   * so a stream needing nothing must not be dragged onto the slower path.
   */
  it('leaves a stream that needs nothing to the platform', () => {
    window.AnimiruMediaHeaders = bridge();

    expect(needsManagedHls({ type: 'hls', url: 'https://cdn.test/a.m3u8' })).toBe(false);
  });

  it('does not claim to manage an mp4, which hls.js cannot play', () => {
    window.AnimiruMediaHeaders = bridge();

    expect(needsManagedHls({
      type: 'mp4', url: 'https://cdn.test/a.mp4', headers: { Referer: 'https://x.test/' }
    })).toBe(false);
  });

  it('does not take the slower path when no shell could use it', () => {
    expect(needsManagedHls({
      type: 'hls', url: 'https://cdn.test/a.m3u8', headers: { Referer: 'https://x.test/' }
    })).toBe(false);
  });
});
