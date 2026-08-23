/**
 * Covers the Jellyfin provider against a stubbed fetch: request shaping,
 * response mapping into the provider contract, quality-tier construction and
 * error translation. No server required, so these stay deterministic.
 */

function jsonResponse(body, { status = 200, ok = true } = {}) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body)
  });
}

const AUTH_OK = {
  AccessToken: 'token-abc',
  User: { Id: 'user-1', Name: 'jim' }
};

let jellyfin;

function freshModule() {
  // The module caches config at import time, so each test gets a clean copy.
  // isolateModules is the sync form; the async variant does not exist in the
  // Jest version react-scripts 5 bundles.
  let mod;
  jest.isolateModules(() => {
    mod = require('../jellyfin');
  });
  return mod;
}

async function connected() {
  const mod = freshModule();
  global.fetch.mockReturnValueOnce(jsonResponse(AUTH_OK));
  await mod.connect({
    server: 'http://192.168.1.10:8096',
    username: 'jim',
    password: 'pw'
  });
  global.fetch.mockClear();
  return mod;
}

beforeEach(() => {
  global.fetch = jest.fn();
  localStorage.clear();
  jellyfin = freshModule();
});

afterEach(() => {
  delete global.fetch;
});

describe('connect', () => {
  test('authenticates and reports the connection', async () => {
    global.fetch.mockReturnValueOnce(jsonResponse(AUTH_OK));

    const result = await jellyfin.connect({
      server: 'http://192.168.1.10:8096',
      username: 'jim',
      password: 'pw'
    });

    expect(result.userId).toBe('user-1');
    expect(jellyfin.isConfigured()).toBe(true);
  });

  test('strips a trailing slash so URLs do not double up', async () => {
    global.fetch.mockReturnValueOnce(jsonResponse(AUTH_OK));

    const result = await jellyfin.connect({
      server: 'http://192.168.1.10:8096/',
      username: 'jim'
    });

    expect(result.server).toBe('http://192.168.1.10:8096');
  });

  // Pasting the address out of a browser is the obvious thing to do, and
  // every one of these previously produced a 404 that looked like a wrong
  // server rather than a mangled URL.
  test.each([
    ['http://192.168.1.10:8096/web/index.html#!/home.html'],
    ['http://192.168.1.10:8096/web/index.html'],
    ['http://192.168.1.10:8096/web/'],
    ['http://192.168.1.10:8096/web'],
    ['http://192.168.1.10:8096//'],
    ['  http://192.168.1.10:8096  ']
  ])('reduces %s to the bare origin', async (pasted) => {
    global.fetch.mockReturnValueOnce(jsonResponse(AUTH_OK));

    const result = await jellyfin.connect({ server: pasted, username: 'jim' });

    expect(result.server).toBe('http://192.168.1.10:8096');
    expect(global.fetch.mock.calls[0][0]).toBe(
      'http://192.168.1.10:8096/Users/AuthenticateByName'
    );
  });

  test('keeps a reverse-proxy sub-path, which is part of the API base', async () => {
    global.fetch.mockReturnValueOnce(jsonResponse(AUTH_OK));

    const result = await jellyfin.connect({
      server: 'https://media.example.com/jellyfin/',
      username: 'jim'
    });

    expect(result.server).toBe('https://media.example.com/jellyfin');
  });

  test('sends the MediaBrowser authorization header', async () => {
    global.fetch.mockReturnValueOnce(jsonResponse(AUTH_OK));

    await jellyfin.connect({ server: 'http://s:8096', username: 'jim' });

    const [, init] = global.fetch.mock.calls[0];
    expect(init.headers.Authorization).toMatch(/^MediaBrowser /);
    expect(init.headers.Authorization).toContain('Client="Animiru"');
  });

  test('never exposes the access token through getConfig', async () => {
    global.fetch.mockReturnValueOnce(jsonResponse(AUTH_OK));
    await jellyfin.connect({ server: 'http://s:8096', username: 'jim' });

    expect(jellyfin.getConfig()).not.toHaveProperty('token');
  });

  test('rejects a response with no token', async () => {
    global.fetch.mockReturnValueOnce(jsonResponse({ User: { Id: 'x' } }));

    await expect(
      jellyfin.connect({ server: 'http://s:8096', username: 'jim' })
    ).rejects.toThrow(/did not return an access token/i);
  });

  test('requires a server address', async () => {
    await expect(jellyfin.connect({ server: '  ' })).rejects.toThrow(
      /server address/i
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('search', () => {
  test('maps Jellyfin items into the provider contract', async () => {
    const mod = await connected();
    global.fetch.mockReturnValueOnce(
      jsonResponse({
        Items: [
          {
            Id: 'series-1',
            Name: 'Cowboy Bebop',
            Type: 'Series',
            ProductionYear: 1998,
            ImageTags: { Primary: 'tag1' }
          }
        ]
      })
    );

    const [item] = await mod.search('bebop');

    expect(item.id).toBe('series-1');
    expect(item.providerId).toBe('jellyfin');
    expect(item.title).toBe('Cowboy Bebop');
    expect(item.kind).toBe('series');
    expect(item.poster).toContain('/Items/series-1/Images/Primary');
  });

  test('returns nothing when no server is connected', async () => {
    await expect(jellyfin.search('x')).resolves.toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('getEpisodes', () => {
  test('maps episodes including season and number', async () => {
    const mod = await connected();
    global.fetch.mockReturnValueOnce(
      jsonResponse({
        Items: [
          {
            Id: 'ep-1',
            Name: 'Asteroid Blues',
            IndexNumber: 1,
            ParentIndexNumber: 1,
            ImageTags: {}
          }
        ]
      })
    );

    const [ep] = await mod.getEpisodes('series-1');

    expect(ep).toMatchObject({
      id: 'ep-1',
      title: 'Asteroid Blues',
      number: 1,
      season: 1
    });
  });
});

describe('getStreams', () => {
  test('offers direct play plus every transcode tier', async () => {
    const mod = await connected();

    const { options } = await mod.getStreams('ep-1');

    expect(options.map((o) => o.label)).toEqual([
      'Original',
      '1080p',
      '720p',
      '480p',
      '360p'
    ]);
  });

  test('asks the transcoder for the tier width and bitrate', async () => {
    const mod = await connected();

    const { options } = await mod.getStreams('ep-1');
    const hd = new URL(options.find((o) => o.label === '720p').url);

    expect(hd.searchParams.get('maxWidth')).toBe('1280');
    expect(hd.searchParams.get('videoBitRate')).toBe('4000000');
    expect(hd.pathname).toBe('/Videos/ep-1/main.m3u8');
  });

  test('direct play requests no width or bitrate ceiling', async () => {
    const mod = await connected();

    const { options } = await mod.getStreams('ep-1');
    const original = new URL(options[0].url);

    expect(original.searchParams.get('maxWidth')).toBeNull();
    expect(original.searchParams.get('videoBitRate')).toBeNull();
  });

  test('fails clearly when no server is connected', async () => {
    await expect(jellyfin.getStreams('ep-1')).rejects.toThrow(
      /Connect a Jellyfin server/i
    );
  });
});

describe('error translation', () => {
  test('an unreachable server names the address', async () => {
    const mod = await connected();
    global.fetch.mockReturnValueOnce(Promise.reject(new TypeError('failed')));

    await expect(mod.search('x')).rejects.toThrow(/192\.168\.1\.10:8096/);
  });

  test('401 asks the user to sign in again', async () => {
    const mod = await connected();
    global.fetch.mockReturnValueOnce(jsonResponse({}, { status: 401, ok: false }));

    await expect(mod.search('x')).rejects.toThrow(/sign in again/i);
  });
});

describe('disconnect', () => {
  test('clears the stored connection', async () => {
    const mod = await connected();
    expect(mod.isConfigured()).toBe(true);

    mod.disconnect();

    expect(mod.isConfigured()).toBe(false);
    expect(mod.getConfig()).toBeNull();
  });
});
