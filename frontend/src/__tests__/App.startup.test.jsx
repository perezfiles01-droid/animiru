import React from 'react';
import { render } from '@testing-library/react';
import App from '../App';

/**
 * The first screen, which was blank.
 *
 * The Android shell opened the app at /index.html - the file, which is the
 * natural thing to load and the wrong thing to navigate to. React Router
 * matches on the pathname, no route was declared for /index.html, and
 * <Routes> renders null when nothing matches. Navbar and BottomNav sit
 * outside it and rendered as usual, so the app looked alive with an empty
 * middle.
 *
 * Tapping any tab pushed a path that did match, which is why switching away
 * and back "fixed" it, and why this survived: the web build is served at /
 * and was never affected. Only the APK was, on every single launch.
 *
 * Two assertions, because there are two failures to prevent. The first is
 * this bug: the shell's own start path must render something. The second is
 * the class it belongs to - no path at all may render an empty screen,
 * including paths nobody has written yet.
 */

const mainContent = () => document.querySelector('.main-content');

const renderAt = (path) => {
  window.history.pushState({}, '', path);
  return render(<App />);
};

describe('the path the Android shell actually opens', () => {
  /*
   * Kept in step with MainActivity's START_URL by a check in
   * backend/tests/mobile.shell.test.js. The two drifting apart is precisely
   * what caused this, so neither is trusted to be right on its own.
   */
  it('renders the app, not an empty page', () => {
    renderAt('/index.html');

    expect(mainContent()).not.toBeEmptyDOMElement();
  });

  it('lands on the same screen the root does', () => {
    renderAt('/index.html');
    const fromIndex = mainContent().innerHTML;

    document.body.innerHTML = '';
    renderAt('/');

    expect(mainContent().innerHTML).toBe(fromIndex);
  });
});

describe('any path that matches nothing', () => {
  /*
   * A blank screen is the worst possible answer to a bad URL: it looks like
   * the app crashed, and it says nothing about what went wrong. A route
   * renamed later, a mistyped deep link, or a URL restored from a previous
   * version all arrive here.
   */
  it.each([
    '/index.html',
    '/browse',
    '/some/old/route',
    '/settings/removed-page'
  ])('shows the app rather than nothing at %s', (path) => {
    renderAt(path);

    expect(mainContent()).not.toBeEmptyDOMElement();
  });

  // The routes that exist must still be reachable: a catch-all that swallows
  // real paths would trade a blank home screen for an app with one page.
  it.each([
    '/',
    '/library',
    '/history',
    '/settings'
  ])('leaves the real route %s alone', (path) => {
    renderAt(path);

    expect(mainContent()).not.toBeEmptyDOMElement();
  });

  it('does not send a declared route to the same place as an unknown one', () => {
    renderAt('/settings');
    const settings = mainContent().innerHTML;

    document.body.innerHTML = '';
    renderAt('/no-such-page');

    expect(mainContent().innerHTML).not.toBe(settings);
  });
});
