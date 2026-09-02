import React from 'react';
import { render, screen, act } from '@testing-library/react';
import VideoPlayer from '../VideoPlayer';
import { describeMediaError } from '../VideoPlayer';

/**
 * Why "this server could not be played" was never enough to act on.
 *
 * Android's WebView plays HLS natively, so the player skips hls.js and loads
 * the URL straight into a <video> element. That path had one error handler
 * and one sentence, so a CDN refusing the request without a Referer, a host
 * that no longer exists, and a codec the device cannot decode all produced
 * the same line. Three different problems - one needing a header, one
 * needing the source retired, one needing nothing at all - were
 * indistinguishable from the screen, and from a screenshot of it.
 *
 * The <video> element already knows which it was: MediaError.code says
 * network, decode, or nothing-here-to-play. It was being thrown away in the
 * handler. The hls.js branch was always more specific than this, so this is
 * the native path catching up rather than a new idea.
 */

describe('naming a media failure', () => {
  it('says a network failure is one, so a blocked CDN is not read as a bad file', () => {
    expect(describeMediaError({ code: 2 }, 'https://cdn.test/a.m3u8'))
      .toMatch(/did not respond|network/i);
  });

  it('names the host, because that is what says which CDN refused', () => {
    expect(describeMediaError({ code: 2 }, 'https://bd.24stream.xyz/media/x.m3u8'))
      .toMatch(/bd\.24stream\.xyz/);
  });

  it('separates a file the device cannot decode from one it could not fetch', () => {
    const decode = describeMediaError({ code: 3 }, 'https://cdn.test/a.mp4');
    const network = describeMediaError({ code: 2 }, 'https://cdn.test/a.mp4');

    expect(decode).not.toBe(network);
    expect(decode).toMatch(/decode|corrupt/i);
  });

  it('separates an unusable source from both of those', () => {
    const unsupported = describeMediaError({ code: 4 }, 'https://cdn.test/a.mkv');

    expect(unsupported).not.toBe(describeMediaError({ code: 2 }, 'https://cdn.test/a.mkv'));
    expect(unsupported).not.toBe(describeMediaError({ code: 3 }, 'https://cdn.test/a.mkv'));
  });

  // The element is not obliged to populate error, and a player that throws
  // while reporting a failure tells you even less than one that says nothing.
  it('still says something when the element reports no detail', () => {
    expect(typeof describeMediaError(null, 'https://cdn.test/a.m3u8')).toBe('string');
    expect(describeMediaError(null, 'https://cdn.test/a.m3u8').length).toBeGreaterThan(0);
  });

  it('survives a url that is not one', () => {
    expect(typeof describeMediaError({ code: 2 }, 'not a url')).toBe('string');
  });
});

describe('the native path, which is the one Android takes', () => {
  const streams = {
    home: 'https://anidap.lol',
    options: [{
      id: '0:Kiwi:1080p',
      label: 'Kiwi [1080p]',
      server: 'Kiwi',
      quality: '1080p',
      url: 'https://bd.24stream.xyz/media/x.mp4',
      type: 'mp4',
      subtitles: [],
      audios: []
    }]
  };

  it('reports the element\'s own reason rather than one fixed sentence', () => {
    render(<VideoPlayer streams={streams} title="Test" />);

    const video = document.querySelector('video');

    act(() => {
      // What the element reports when a host refuses the request.
      Object.defineProperty(video, 'error', { value: { code: 2 }, configurable: true });
      video.dispatchEvent(new Event('error'));
    });

    expect(screen.getByText(/bd\.24stream\.xyz/)).toBeInTheDocument();
  });
});
