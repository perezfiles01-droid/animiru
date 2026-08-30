/**
 * AniList as a tracker.
 *
 * The token is obtained by the implicit grant and kept on the device: the
 * alternative needs a client secret, which would have to live on our server
 * and would put every user's token through it.
 */

import * as anilist from '../anilist';

const ok = (data) => Promise.resolve({
  status: 200, json: () => Promise.resolve({ data })
});

describe('connecting', () => {
  beforeEach(() => { window.localStorage.clear(); global.fetch = jest.fn(); });
  afterEach(() => { delete global.fetch; });

  it('is not connected before a token is stored', () => {
    expect(anilist.isConnected()).toBe(false);
  });

  it('sends the user to AniList with their own client id', () => {
    expect(anilist.authorizeUrl('12345'))
      .toBe('https://anilist.co/api/v2/oauth/authorize?client_id=12345&response_type=token');
  });

  // The token comes back in the fragment, which is never sent to a server -
  // not even ours.
  it('reads the token out of the returned fragment', () => {
    expect(anilist.tokenFromFragment('#access_token=abc123&token_type=Bearer'))
      .toBe('abc123');
  });

  it('finds no token in a fragment that carries none', () => {
    expect(anilist.tokenFromFragment('#error=access_denied')).toBeNull();
    expect(anilist.tokenFromFragment('')).toBeNull();
  });

  it('remembers who the token belongs to', async () => {
    global.fetch.mockReturnValue(ok({
      Viewer: { id: 7, name: 'perez', avatar: { medium: 'https://i.test/a.png' } }
    }));

    const viewer = await anilist.connect('abc123');

    expect(viewer).toMatchObject({ id: 7, name: 'perez' });
    expect(anilist.isConnected()).toBe(true);
    expect(anilist.getUser().name).toBe('perez');
  });

  // A stored token that cannot identify anyone would make the screen claim
  // a connection that does not work.
  it('keeps no token that AniList will not accept', async () => {
    global.fetch.mockResolvedValue({ status: 401, json: () => Promise.resolve({}) });

    await expect(anilist.connect('bad')).rejects.toThrow(/rejected the token/);
    expect(anilist.isConnected()).toBe(false);
  });

  it('disconnects', async () => {
    global.fetch.mockReturnValue(ok({ Viewer: { id: 7, name: 'perez', avatar: {} } }));
    await anilist.connect('abc123');

    anilist.disconnect();

    expect(anilist.isConnected()).toBe(false);
    expect(anilist.getUser()).toBeNull();
  });
});

describe('recording progress', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    global.fetch = jest.fn().mockReturnValue(ok({ Viewer: { id: 7, name: 'p', avatar: {} } }));
    await anilist.connect('token');
    global.fetch.mockReset();
  });
  afterEach(() => { delete global.fetch; });

  const withCurrentProgress = (progress, saved = { id: 1, progress: 5 }) => {
    global.fetch.mockImplementation((url, options) => {
      const { query } = JSON.parse(options.body);
      if (query.includes('mediaListEntry')) {
        return ok({
          Media: { mediaListEntry: progress === null ? null : { progress, status: 'CURRENT' } }
        });
      }
      return ok({ SaveMediaListEntry: saved });
    });
  };

  it('records an episode against the title', async () => {
    withCurrentProgress(null, { id: 1, progress: 3, status: 'CURRENT' });

    expect(await anilist.setProgress(101, 3)).toMatchObject({ progress: 3 });
  });

  // Rewatching an early episode, or opening one out of order, must not undo
  // progress the user actually made.
  it('never lowers progress already recorded', async () => {
    withCurrentProgress(12);

    expect(await anilist.setProgress(101, 3)).toEqual({ progress: 12, unchanged: true });
    // Only the read happened; the mutation must not have.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('records an episode beyond what was there', async () => {
    withCurrentProgress(3, { id: 1, progress: 4 });

    expect(await anilist.setProgress(101, 4)).toMatchObject({ progress: 4 });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('ignores an episode with no usable number', async () => {
    expect(await anilist.setProgress(101, undefined)).toBeNull();
    expect(await anilist.setProgress(101, 0)).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refuses to work without a connection', async () => {
    anilist.disconnect();
    await expect(anilist.setProgress(101, 1)).rejects.toThrow(/Not connected/);
  });

  // GraphQL reports errors with a 200, so the status alone proves nothing.
  it('notices an error returned with a 200', async () => {
    global.fetch.mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ errors: [{ message: 'Invalid media id' }] })
    });

    await expect(anilist.setProgress(101, 1)).rejects.toThrow('Invalid media id');
  });
});

describe('the sync setting', () => {
  beforeEach(() => window.localStorage.clear());

  // Tracking that never syncs is decoration.
  it('is on by default', () => {
    expect(anilist.isAutoSyncEnabled()).toBe(true);
  });

  it('can be turned off and stays off', () => {
    anilist.setAutoSyncEnabled(false);
    expect(anilist.isAutoSyncEnabled()).toBe(false);
  });
});

/**
 * The Android app serves its UI from a virtual origin that exists only
 * inside the WebView, and the authorize page opens in the real browser, so
 * a redirect back to our own address fails there with the token stranded in
 * the browser's address bar. AniList's PIN page shows the token instead.
 */
describe('coming back from AniList', () => {
  it('redirects to a page AniList itself serves', () => {
    expect(anilist.REDIRECT_URL).toBe('https://anilist.co/api/v2/oauth/pin');
  });

  it('does not send the user back to an address only the app can resolve', () => {
    expect(anilist.REDIRECT_URL).not.toMatch(/appassets\.androidplatform\.net/);
    expect(anilist.REDIRECT_URL).not.toMatch(/localhost/);
  });

  it('accepts a token pasted in by hand', async () => {
    window.localStorage.clear();
    global.fetch = jest.fn().mockReturnValue(ok({
      Viewer: { id: 7, name: 'perez', avatar: {} }
    }));

    await anilist.connect('  pasted-token  ');

    expect(anilist.isConnected()).toBe(true);
    // Trimmed: a token copied on a phone routinely brings whitespace with
    // it, and AniList rejects the header if it is there.
    expect(global.fetch.mock.calls[0][1].headers.Authorization)
      .toBe('Bearer pasted-token');

    delete global.fetch;
  });
});
