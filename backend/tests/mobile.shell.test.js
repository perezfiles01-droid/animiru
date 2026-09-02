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

/**
 * The path the shell opens the app at.
 *
 * React Router matches on the pathname, so what the shell navigates to has
 * to be a route the app declares. It was "/index.html" - the file, which is
 * the natural thing to load and the wrong thing to navigate to. No route
 * matched, <Routes> rendered null, and because Navbar and BottomNav are
 * outside it the app drew its own frame around an empty middle on every
 * single launch.
 *
 * The Java and the JavaScript drifting apart is exactly what caused it, so
 * this reads the start URL here and the routes there rather than trusting
 * either on its own.
 */
describe('where the shell starts the app', () => {
  const APP_JS = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'src', 'App.js'),
    'utf8'
  );

  const startUrl = () => {
    const match = MAIN_ACTIVITY.match(/START_URL\s*=\s*APP_ORIGIN\s*\+\s*"([^"]*)"/);
    if (!match) throw new Error('START_URL is not built from APP_ORIGIN any more');
    return match[1];
  };

  const handleBody = () => methodBody(MAIN_ACTIVITY, 'public WebResourceResponse handle');

  /**
   * Whether the root path is answered before the delegate is consulted.
   *
   * This is the distinction that matters, and the one an earlier version of
   * this file missed. WebViewAssetLoader strips the leading slash, so "/"
   * arrives at the handler as an empty string - and AssetsPathHandler does
   * not return null for it. It returns a response the WebView cannot read,
   * so a fallback written after the delegate call never runs.
   */
  const answersRootFirst = () => {
    const body = handleBody();
    const rootCheck = body.search(/path\s*==\s*null|isEmpty\(\)|"\/"\.equals/);
    const firstDelegate = body.indexOf('delegate.handle');

    return rootCheck !== -1 && firstDelegate !== -1 && rootCheck < firstDelegate;
  };

  /*
   * THE INVARIANT, in one sentence: the app must actually load from the URL
   * the shell opens.
   *
   * Asserting that the start URL was "/" is what let a dead app through a
   * green build. "/" is a perfectly good route and a perfectly good pathname
   * for the router - and the asset handler could not serve it, which no
   * check here was looking at. The two halves have to be asserted together.
   */
  it('opens a URL the asset handler can actually serve', () => {
    const path_ = startUrl();
    const namesAFile = /\.[a-z0-9]+$/i.test(path_);

    expect(namesAFile || answersRootFirst()).toBe(true);
  });

  it('opens a URL the app renders something at', () => {
    const declared = [...APP_JS.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
    const hasCatchAll = declared.includes('*');

    expect(declared.includes(startUrl()) || hasCatchAll).toBe(true);
  });

  // Without this, a start URL that is not a declared route renders the app's
  // frame around nothing - which is the bug the start URL was changed for in
  // the first place.
  it('has a catch-all, so an unmatched start path is not a blank screen', () => {
    expect(APP_JS).toMatch(/<Route\s+path="\*"/);
  });

  /*
   * Independent of the start URL, because someone will point the shell at
   * the root again. The root must be answered with index.html rather than
   * handed to a delegate that cannot serve it.
   */
  it('serves index.html for the root rather than an unusable response', () => {
    expect(answersRootFirst()).toBe(true);
    expect(MAIN_ACTIVITY).toContain('INDEX_PATH = "index.html"');
  });
});


/**
 * Running a browser check instead of fetching it.
 *
 * The device was never the address being refused - it is on an ordinary
 * connection - but HttpURLConnection moves bytes and executes nothing, so
 * asking it for a JavaScript check retrieved the check itself and the source
 * parsed nothing out of it. The shell has a browser; this is it.
 */
describe('the browser check solver', () => {
  const fs = require('fs');
  const path = require('path');

  const DEVICE_FETCH = fs.readFileSync(
    path.join(__dirname, '..', '..', 'mobile', 'android', 'app', 'src', 'main',
      'java', 'com', 'animiru', 'app', 'DeviceFetch.java'),
    'utf8'
  );

  it('is reachable from the page under the name it looks for', () => {
    expect(DEVICE_FETCH).toMatch(/@JavascriptInterface\s+public void solve\(/);
  });

  // A WebView may only be touched from the main thread, and the app's own
  // WebView is showing the page that asked - navigating it would take the
  // user with it.
  it('runs the check in a WebView of its own, on the main thread', () => {
    const body = methodBody(DEVICE_FETCH, 'private void solveOnMainThread');

    expect(body).toContain('new WebView(');
    expect(body).toMatch(/Looper\.getMainLooper\(\)/);
    expect(body).toMatch(/setJavaScriptEnabled\(true\)/);
  });

  // The whole point: read the finished page back out of the browser.
  it('reads the settled page back', () => {
    expect(methodBody(DEVICE_FETCH, 'private void solveOnMainThread'))
      .toContain('document.documentElement.outerHTML');
  });

  /**
   * One solved check has to serve the requests that follow it. Without the
   * shared jar every later request is challenged again and each needs its
   * own browser, which is the expensive thing this avoids.
   */
  it('shares the clearance cookie with the plain fetcher', () => {
    expect(methodBody(DEVICE_FETCH, 'private JSONObject perform'))
      .toMatch(/CookieManager\.getInstance\(\)\.getCookie/);
    expect(methodBody(DEVICE_FETCH, 'private JSONObject perform'))
      .toMatch(/setCookie/);
  });

  // A check that never clears must not leave the run waiting for ever.
  it('gives up on a check that does not clear', () => {
    expect(DEVICE_FETCH).toMatch(/CHALLENGE_TIMEOUT_MS\s*=\s*\d+/);
    expect(methodBody(DEVICE_FETCH, 'private void solveOnMainThread'))
      .toContain('postDelayed');
  });

  // Answered once, whichever comes first - the settled page or the
  // deadline - or the page could be delivered after the giving up.
  it('answers exactly once', () => {
    expect(methodBody(DEVICE_FETCH, 'private void solveOnMainThread'))
      .toMatch(/answered\.getAndSet\(true\)/);
  });

  // The same rule the plain path follows: moving a request to the device
  // must not become the way an extension reaches the user's own network.
  it('refuses a private address here too', () => {
    expect(methodBody(DEVICE_FETCH, 'public void solve'))
      .toMatch(/isPrivateAddress\(url\.getHost\(\)\)/);
  });
});
