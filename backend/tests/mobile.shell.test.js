/**
 * The Android shell, read as text.
 *
 * None of this can be executed here - there is no Android SDK and no
 * device - so these are the few properties worth pinning by reading the
 * source: the ones whose absence is invisible until someone is holding a
 * phone, and which were in fact absent.
 */

const fs = require('fs');
const path = require('path');

const MAIN_ACTIVITY = fs.readFileSync(
  path.join(__dirname, '..', '..', 'mobile', 'android', 'app', 'src', 'main',
    'java', 'com', 'animiru', 'app', 'MainActivity.java'),
  'utf8'
);

/** The body of a method, from its signature to the matching brace. */
function methodBody(source, signature) {
  const start = source.indexOf(signature);
  if (start === -1) throw new Error(`No such method: ${signature}`);

  let depth = 0;
  for (let index = source.indexOf('{', start); index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Unbalanced braces after ${signature}`);
}

/**
 * Fullscreen used to lock the orientation and keep the screen awake but
 * leave the status and navigation bars exactly where they were, so the
 * clock and the battery percentage sat on top of the video for its whole
 * runtime.
 */
describe('fullscreen video', () => {
  it('hides the system bars when it starts', () => {
    expect(methodBody(MAIN_ACTIVITY, 'public void onShowCustomView'))
      .toContain('setSystemBarsHidden(true)');
  });

  // Worse than the bug being fixed: an app that hides the bars and never
  // brings them back is unusable everywhere else.
  it('brings them back when it ends', () => {
    expect(methodBody(MAIN_ACTIVITY, 'private void exitFullscreen'))
      .toContain('setSystemBarsHidden(false)');
  });

  it('lets a swipe reach them, so Back and Home are still there', () => {
    expect(methodBody(MAIN_ACTIVITY, 'private void setSystemBarsHidden'))
      .toContain('BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE');
  });

  // Hiding the bars without this leaves the gap they occupied behind.
  it('lets the video fill the space the bars had', () => {
    expect(methodBody(MAIN_ACTIVITY, 'private void setSystemBarsHidden'))
      .toContain('setDecorFitsSystemWindows');
  });

  it('uses the cutout area only while fullscreen', () => {
    const body = methodBody(MAIN_ACTIVITY, 'private void setSystemBarsHidden');

    expect(body).toContain('LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES');
    expect(body).toContain('LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT');
  });
});

/**
 * The bridge that fetches a request the server was refused. It is reachable
 * from the page, so what it refuses matters as much as what it does.
 */
describe('the device fetch bridge', () => {
  const DEVICE_FETCH = fs.readFileSync(
    path.join(__dirname, '..', '..', 'mobile', 'android', 'app', 'src', 'main',
      'java', 'com', 'animiru', 'app', 'DeviceFetch.java'),
    'utf8'
  );

  it('is attached to the WebView under the name the page looks for', () => {
    expect(MAIN_ACTIVITY).toContain('addJavascriptInterface(new DeviceFetch(webView), "AnimiruDeviceFetch")');
  });

  // The server refuses to fetch a private address on an extension's behalf.
  // Moving the request to the phone must not be the way around that.
  it('refuses a private address, as the server does', () => {
    expect(DEVICE_FETCH).toContain('isPrivateAddress');
    expect(methodBody(DEVICE_FETCH, 'private JSONObject perform'))
      .toMatch(/isPrivateAddress\(url\.getHost\(\)\)/);
  });

  it('caps the body at the size the server caps it', () => {
    expect(DEVICE_FETCH).toContain('MAX_BODY_BYTES = 5 * 1024 * 1024');
  });
});

/**
 * Getting a stream's headers as far as the CDN.
 *
 * A source knows the Referer its stream host insists on and has always sent
 * it; nothing used it for the video. The page cannot: Referer and Origin are
 * forbidden header names, so script may not set them. The shell is native
 * code and may, which is the only reason this class exists.
 *
 * None of it can be executed here, so these pin the properties whose absence
 * would be invisible until someone is holding a phone.
 */
describe('the media header bridge', () => {
  const MEDIA_HEADERS = fs.readFileSync(
    path.join(__dirname, '..', '..', 'mobile', 'android', 'app', 'src', 'main',
      'java', 'com', 'animiru', 'app', 'MediaHeaders.java'),
    'utf8'
  );

  it('is attached to the WebView under the name the page looks for', () => {
    expect(MAIN_ACTIVITY).toContain('addJavascriptInterface(mediaHeaders, "AnimiruMediaHeaders")');
  });

  /*
   * The asset loader serves the app's own files and must keep answering
   * first. A stream is never one of them, so asking it first costs nothing
   * and getting the order wrong would put every page load through a lookup
   * that cannot match.
   */
  it('answers only after the app\'s own files have been offered', () => {
    const body = methodBody(MAIN_ACTIVITY, 'public WebResourceResponse shouldInterceptRequest');

    expect(body.indexOf('assetLoader.shouldInterceptRequest'))
      .toBeLessThan(body.indexOf('mediaHeaders.intercept'));
  });

  /*
   * Everything not registered has to come back null, or this class stops
   * being a header proxy and becomes the WebView's entire network stack.
   */
  it('hands back anything it was not told about', () => {
    expect(methodBody(MEDIA_HEADERS, 'WebResourceResponse intercept'))
      .toMatch(/headers\s*==\s*null\)\s*return null/);
  });

  /*
   * Range is what makes seeking work. Forwarding the source's headers but
   * dropping the player's Range would refetch the file from the start on
   * every seek, which looks like a stall rather than a bug.
   */
  it('forwards the request\'s own headers, so seeking still works', () => {
    const body = methodBody(MEDIA_HEADERS, 'WebResourceResponse intercept');

    expect(body).toContain('request.getRequestHeaders()');
    expect(body).toMatch(/content-range|accept-ranges/i);
  });

  // Hop-by-hop headers belong to the connection this class makes, not to
  // the request being described, and a page setting them corrupts the
  // transfer.
  it('refuses to forward hop-by-hop headers', () => {
    expect(MEDIA_HEADERS).toMatch(/BLOCKED\s*=\s*\{[^}]*"transfer-encoding"/);
    expect(methodBody(MEDIA_HEADERS, 'public void register')).toContain('isBlocked');
  });

  /*
   * One episode's hosts must not receive the previous episode's Referer, so
   * a registration replaces rather than accumulates.
   */
  it('forgets the previous episode when a new one registers', () => {
    expect(methodBody(MEDIA_HEADERS, 'public void register')).toContain('byUrl.clear()');
  });

  it('caps what a page can make it remember', () => {
    expect(MEDIA_HEADERS).toMatch(/MAX_ENTRIES\s*=\s*\d+/);
    expect(methodBody(MEDIA_HEADERS, 'public void register')).toContain('MAX_ENTRIES');
  });
});
