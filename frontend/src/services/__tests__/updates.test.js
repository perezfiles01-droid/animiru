/**
 * The update check.
 *
 * The comparison is the part worth pinning: done as text rather than
 * numerically, v1.0.9 sorts above v1.0.43 and the app silently stops
 * offering updates after the ninth build.
 */

import { compareVersions, checkForUpdate } from '../updates';

describe('compareVersions', () => {
  it.each([
    ['v1.0.44', 'v1.0.43', 'newer'],
    ['v1.0.43', 'v1.0.44', 'older'],
    ['v1.0.43', 'v1.0.43', 'equal'],
    ['v1.1.0', 'v1.0.99', 'newer'],
    ['v2.0.0', 'v1.9.9', 'newer']
  ])('%s vs %s is %s', (a, b, expected) => {
    const result = compareVersions(a, b);
    const actual = result > 0 ? 'newer' : result < 0 ? 'older' : 'equal';
    expect(actual).toBe(expected);
  });

  it('compares numerically, not as text', () => {
    // The bug this prevents: "v1.0.9" > "v1.0.43" lexicographically.
    expect(compareVersions('v1.0.43', 'v1.0.9')).toBeGreaterThan(0);
  });

  it('tolerates a missing v prefix and short versions', () => {
    expect(compareVersions('1.0.43', 'v1.0.43')).toBe(0);
    expect(compareVersions('v1.1', 'v1.0.9')).toBeGreaterThan(0);
  });
});

describe('checkForUpdate', () => {
  const RELEASE = {
    tag_name: 'v1.0.99',
    name: 'Animiru v1.0.99',
    body: 'Fixed a thing.\nAdded another.',
    html_url: 'https://github.com/x/y/releases/tag/v1.0.99',
    published_at: '2026-08-30T00:00:00Z',
    assets: [
      { name: 'animiru-app.apk', browser_download_url: 'https://example.test/app.apk' },
      { name: 'other.txt', browser_download_url: 'https://example.test/other.txt' }
    ]
  };

  function respond(body, { status = 200, ok = true } = {}) {
    global.fetch = jest.fn().mockResolvedValue({
      ok, status, json: async () => body
    });
  }

  afterEach(() => { delete global.fetch; });

  it('reports a newer release, with its notes and the APK', async () => {
    respond(RELEASE);
    const result = await checkForUpdate();

    expect(result).toMatchObject({
      version: 'v1.0.99',
      notes: 'Fixed a thing.\nAdded another.',
      downloadUrl: 'https://example.test/app.apk'
    });
  });

  it('treats a build with no stamped version as up to date', async () => {
    // A development build cannot apply an APK update, so nagging about one
    // would be noise.
    respond(RELEASE);
    expect((await checkForUpdate()).isNewer).toBe(false);
  });

  it('explains a rate limit rather than reporting a bare 403', async () => {
    respond({}, { status: 403, ok: false });
    await expect(checkForUpdate()).rejects.toThrow(/rate-limited/);
  });

  it('explains when nothing has been released', async () => {
    respond({}, { status: 404, ok: false });
    await expect(checkForUpdate()).rejects.toThrow(/No releases/);
  });

  it('explains being offline', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(checkForUpdate()).rejects.toThrow(/Could not reach GitHub/);
  });

  it('falls back to the release page when no APK is attached', async () => {
    respond({ ...RELEASE, assets: [] });
    expect((await checkForUpdate()).downloadUrl).toBeNull();
  });
});
