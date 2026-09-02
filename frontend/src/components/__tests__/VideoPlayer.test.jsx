/**
 * The player's controls.
 *
 * Servers matter because several of them routinely fail and switching is the
 * only fix available from the app. Subtitles matter because they were being
 * dropped entirely. Both are pinned here, along with the two traps found
 * building them: mirrors share labels, so a label cannot be a React key, and
 * a subtitle must not be linked cross-origin or the video stops playing.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VideoPlayer from '../VideoPlayer';

jest.mock('hls.js', () => ({
  __esModule: true,
  default: { isSupported: () => false, Events: {}, ErrorTypes: {} }
}));

/**
 * Fires the media element's error event, which is how a dead server
 * announces itself for a non-HLS source.
 */
function failCurrentServer(container) {
  const video = container.querySelector('video');
  video.dispatchEvent(new Event('error'));
}

/** Marks playback as started, after which a failure is no longer skipped. */
function startPlayback(container) {
  container.querySelector('video').dispatchEvent(new Event('playing'));
}

jest.mock('../../services/extensions/client', () => ({
  subtitleUrl: (url, referer) =>
    `http://api.test/extensions/subtitle?url=${encodeURIComponent(url)}`
    + (referer ? `&referer=${encodeURIComponent(referer)}` : '')
}));

function option(overrides = {}) {
  return {
    id: '0:Vidstreaming:1080p',
    label: 'Vidstreaming - 1080p',
    server: 'Vidstreaming',
    quality: '1080p',
    url: 'https://cdn.test/a.m3u8',
    type: 'hls',
    height: 1080,
    subtitles: [],
    audios: [],
    isDub: false,
    ...overrides
  };
}

const renderPlayer = (options, props = {}) =>
  render(<VideoPlayer streams={{ options }} title="E1" {...props} />);

beforeEach(() => {
  global.URL.createObjectURL = jest.fn(() => 'blob:mock');
  global.URL.revokeObjectURL = jest.fn();
});

describe('servers', () => {
  it('lists every server the source returned', () => {
    renderPlayer([
      option({ id: 'a', server: 'Vidstreaming' }),
      option({ id: 'b', server: 'Doodstream' }),
      option({ id: 'c', server: 'Mp4Upload' })
    ]);

    const select = screen.getByLabelText('Server');
    expect(select.querySelectorAll('option')).toHaveLength(3);
  });

  it('shows mirrors that share a label as separate choices', () => {
    // The bug this covers: a shared label was used as a React key, so the
    // list collapsed and the wrong option could be selected.
    renderPlayer([
      option({ id: '0:Server:1080p', server: 'Server', quality: '1080p' }),
      option({ id: '1:Server:1080p', server: 'Server', quality: '1080p' })
    ]);

    // Numbered, because they are different streams under one name and
    // collapsing them would leave no way to reach the second by hand.
    expect([...screen.getByLabelText('Server').options].map((o) => o.text))
      .toEqual(['Server', 'Server (2)']);
  });

  // Sources put both in one string - "1080p [SUB - mega]" - so a single
  // menu listing those strings was really showing quality, which is what
  // users reported. They are separate controls.
  it('offers quality and server as separate controls', () => {
    renderPlayer([option(), option({ id: 'b', server: 'Doodstream', quality: '720p' })]);

    expect([...screen.getByLabelText('Quality').options].map((o) => o.text))
      .toEqual(['1080p', '720p']);
    expect([...screen.getByLabelText('Server').options].map((o) => o.text))
      .toEqual(['Vidstreaming', 'Doodstream']);
  });

  it('lists a server once however many qualities it carries', () => {
    renderPlayer([
      option({ id: 'a', server: 'Mega', quality: '1080p', height: 1080 }),
      option({ id: 'b', server: 'Mega', quality: '720p', height: 720 })
    ]);

    // One server, so no Server control to show - quality is the only choice.
    expect(screen.queryByLabelText('Server')).not.toBeInTheDocument();
    expect([...screen.getByLabelText('Quality').options].map((o) => o.text))
      .toEqual(['1080p', '720p']);
  });

  it('keeps the server when the quality changes', async () => {
    renderPlayer([
      option({ id: 'a', server: 'Mega', quality: '1080p', height: 1080, url: 'https://cdn.test/mega-1080.m3u8' }),
      option({ id: 'b', server: 'Kiwi', quality: '1080p', height: 1080 }),
      option({ id: 'c', server: 'Mega', quality: '720p', height: 720, url: 'https://cdn.test/mega-720.m3u8' })
    ]);

    await userEvent.selectOptions(screen.getByLabelText('Server'), 'Mega');
    await userEvent.selectOptions(screen.getByLabelText('Quality'), '720p');

    expect(screen.getByLabelText('Server').value).toBe('Mega');
    expect(screen.getByLabelText('Quality').value).toBe('720p');
  });

  it('keeps the quality when the server changes', async () => {
    renderPlayer([
      option({ id: 'a', server: 'Mega', quality: '1080p', height: 1080 }),
      option({ id: 'b', server: 'Mega', quality: '720p', height: 720 }),
      option({ id: 'c', server: 'Kiwi', quality: '720p', height: 720 })
    ]);

    await userEvent.selectOptions(screen.getByLabelText('Quality'), '720p');
    await userEvent.selectOptions(screen.getByLabelText('Server'), 'Kiwi');

    expect(screen.getByLabelText('Quality').value).toBe('720p');
    expect(screen.getByLabelText('Server').value).toBe('Kiwi');
  });

  // Not every mirror carries every resolution; the control the user just
  // touched wins and the other gives way rather than nothing happening.
  it('honours the control just used when the pairing does not exist', async () => {
    renderPlayer([
      option({ id: 'a', server: 'Mega', quality: '1080p', height: 1080 }),
      option({ id: 'b', server: 'Kiwi', quality: '480p', height: 480 })
    ]);

    await userEvent.selectOptions(screen.getByLabelText('Server'), 'Kiwi');

    expect(screen.getByLabelText('Server').value).toBe('Kiwi');
    expect(screen.getByLabelText('Quality').value).toBe('480p');
  });

  it('offers no server control when there is only one', () => {
    renderPlayer([option()]);
    expect(screen.queryByLabelText('Server')).not.toBeInTheDocument();
  });

  it('says nothing is playable when a source returned nothing', () => {
    renderPlayer([]);
    expect(screen.getByText(/No playable stream/)).toBeInTheDocument();
  });
});

describe('audio', () => {
  it('offers Sub and Dub when the source has both', () => {
    renderPlayer([
      option({ id: 'a', isDub: false }),
      option({ id: 'b', isDub: true, server: 'Server Dub' })
    ]);

    expect(screen.getByLabelText('Audio')).toBeInTheDocument();
  });

  it('does not offer the choice when only one kind exists', () => {
    renderPlayer([option({ id: 'a' }), option({ id: 'b', server: 'Other' })]);
    expect(screen.queryByLabelText('Audio')).not.toBeInTheDocument();
  });

  it('narrows the servers to the chosen audio', async () => {
    renderPlayer([
      option({ id: 'a', server: 'SubOne', isDub: false }),
      option({ id: 'b', server: 'SubTwo', isDub: false }),
      option({ id: 'c', server: 'DubOne', isDub: true })
    ]);

    await userEvent.selectOptions(screen.getByLabelText('Audio'), 'dub');

    // One dub server left, so the control disappears rather than offering
    // a choice of one.
    expect(screen.queryByLabelText('Server')).not.toBeInTheDocument();
  });
});

describe('subtitles', () => {
  const withSubs = (subtitles) => [option({ subtitles })];

  const ENGLISH = { url: 'https://cdn.test/en.vtt', label: 'English', isEnglish: true };
  const SPANISH = { url: 'https://cdn.test/es.vtt', label: 'Spanish', isEnglish: false };

  function respondWith(text = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n') {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, text: async () => text, json: async () => ({})
    });
  }

  afterEach(() => { delete global.fetch; });

  it('offers no CC button when the source has no subtitles', () => {
    renderPlayer([option()]);
    expect(screen.queryByRole('button', { name: 'CC' })).not.toBeInTheDocument();
  });

  // An episode without subtitles is the exception rather than the intent, so
  // the player turns them on itself and CC is there to turn them off.
  it('starts with subtitles on', async () => {
    respondWith();
    renderPlayer(withSubs([ENGLISH]));

    const cc = screen.getByRole('button', { name: 'CC' });
    await waitFor(() => expect(cc).toHaveAttribute('aria-pressed', 'true'));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  });

  it('toggles off and back on', async () => {
    respondWith();
    renderPlayer(withSubs([ENGLISH]));

    const cc = screen.getByRole('button', { name: 'CC' });
    await waitFor(() => expect(cc).toHaveAttribute('aria-pressed', 'true'));

    await userEvent.click(cc);
    expect(cc).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(cc);
    expect(cc).toHaveAttribute('aria-pressed', 'true');
  });

  // Turning them on again on every server switch would make the button
  // useless: the user turned them off, and meant it.
  it('leaves subtitles off after the user turns them off', async () => {
    respondWith();
    const subtitled = (id, server) => ({ ...option({ id, server }), subtitles: [ENGLISH] });
    renderPlayer([subtitled('a', 'Server A'), subtitled('b', 'Server B')]);

    const cc = screen.getByRole('button', { name: 'CC' });
    await waitFor(() => expect(cc).toHaveAttribute('aria-pressed', 'true'));
    await userEvent.click(cc);

    await userEvent.selectOptions(screen.getByLabelText('Server'), 'Server B');

    expect(screen.getByRole('button', { name: 'CC' }))
      .toHaveAttribute('aria-pressed', 'false');
  });

  // AniKoto downloads its own subtitles and hands back the file itself in
  // the field a URL would use. Fetching that produced "The subtitle host
  // responded 404" for a track already in memory.
  it('shows subtitle content a source returned inline, without a request', async () => {
    respondWith();
    renderPlayer(withSubs([{
      content: '1\n00:00:01,000 --> 00:00:02,000\nHello\n', label: 'English', isEnglish: true
    }]));

    await waitFor(() => expect(global.URL.createObjectURL).toHaveBeenCalled());
    expect(global.fetch).not.toHaveBeenCalled();

    const [blob] = global.URL.createObjectURL.mock.calls[0];
    expect(blob.type).toBe('text/vtt');
  });

  it('fetches through the backend rather than linking the host directly', async () => {
    // Linking directly needs crossOrigin on the video, which would make the
    // browser demand CORS for the video too and stop playback.
    respondWith();
    renderPlayer(withSubs([ENGLISH]));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(global.fetch.mock.calls[0][0]).toContain('/extensions/subtitle?url=');
  });

  it('turns the subtitle into a blob, which is same-origin', async () => {
    respondWith();
    renderPlayer(withSubs([ENGLISH]));

    await waitFor(() => expect(global.URL.createObjectURL).toHaveBeenCalled());
  });

  it('prefers an English track when the source labelled one', async () => {
    respondWith();
    renderPlayer(withSubs([SPANISH, ENGLISH]));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(decodeURIComponent(global.fetch.mock.calls[0][0])).toContain('en.vtt');
  });

  it('offers a track list while subtitles are on and there is a choice', async () => {
    respondWith();
    renderPlayer(withSubs([ENGLISH, SPANISH]));

    expect(await screen.findByLabelText('Subtitles')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'CC' }));
    expect(screen.queryByLabelText('Subtitles')).not.toBeInTheDocument();
  });

  it('reports why a subtitle could not be loaded, and turns CC back off', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 415,
      json: async () => ({ error: 'ASS subtitles cannot be shown in a browser.' })
    });
    renderPlayer(withSubs([{ url: 'https://cdn.test/subs.ass', label: 'English' }]));

    expect(await screen.findByText(/ASS subtitles cannot be shown/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CC' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('passes the Referer a host may require', async () => {
    respondWith();
    renderPlayer([option({
      subtitles: [ENGLISH],
      headers: { Referer: 'https://site.test/' }
    })]);

    await userEvent.click(screen.getByRole('button', { name: 'CC' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(global.fetch.mock.calls[0][0]).toContain('referer=');
  });
});


describe('when a server fails', () => {
  const servers = () => [
    option({ id: 'a', server: 'First', type: 'mp4', url: 'https://cdn.test/a.mp4' }),
    option({ id: 'b', server: 'Second', type: 'mp4', url: 'https://cdn.test/b.mp4' }),
    option({ id: 'c', server: 'Third', type: 'mp4', url: 'https://cdn.test/c.mp4' })
  ];

  it('moves to the next server by itself before anything has played', async () => {
    // Nothing to lose at this point, and a dead frame with an error under it
    // asks the user to do what the app can do itself.
    const { container } = renderPlayer(servers());

    failCurrentServer(container);

    expect(await screen.findByText(/First did not play — switched to Second/))
      .toBeInTheDocument();
  });

  it('marks a server that failed, so it is not chosen again unknowingly', async () => {
    const { container } = renderPlayer(servers());
    failCurrentServer(container);

    await screen.findByText(/switched to Second/);
    expect(screen.getByRole('option', { name: /First \(failed\)/ }))
      .toBeInTheDocument();
  });

  it('does not switch once playback has started', async () => {
    // Mid-episode failures are often transient, and switching would discard
    // the viewer's position to fix something that may right itself.
    const { container } = renderPlayer(servers());

    startPlayback(container);
    failCurrentServer(container);

    expect(await screen.findByText(/could not be played/)).toBeInTheDocument();
    expect(screen.queryByText(/switched to/)).not.toBeInTheDocument();
  });

  it('offers the remaining servers when it stops automatically', async () => {
    const { container } = renderPlayer(servers());
    startPlayback(container);
    failCurrentServer(container);

    expect(await screen.findByText(/still untried/)).toBeInTheDocument();
  });

  it('says so when nothing else is left to try', async () => {
    const { container } = renderPlayer([
      option({ id: 'only', server: 'Only', type: 'mp4', url: 'https://cdn.test/a.mp4' })
    ]);

    failCurrentServer(container);

    expect(await screen.findByText(/No other server worked either/)).toBeInTheDocument();
  });

  /*
   * The screen may know of another home for the same episode. It cannot
   * act on that unless it is told the servers here are spent - and the
   * player is the only thing that knows.
   */
  it('tells the page when every server is spent', async () => {
    const onExhausted = jest.fn();
    const { container } = renderPlayer([
      option({ id: 'only', server: 'Only', type: 'mp4', url: 'https://cdn.test/a.mp4' })
    ], { onExhausted });

    failCurrentServer(container);

    await screen.findByText(/No other server worked either/);
    expect(onExhausted).toHaveBeenCalled();
  });

  // While a server remains untried, nothing is spent: switching to it is
  // cheaper than asking the source again.
  it('does not say so while a server is still untried', async () => {
    const onExhausted = jest.fn();
    const { container } = renderPlayer(servers(), { onExhausted });

    startPlayback(container);
    failCurrentServer(container);

    await screen.findByText(/still untried/);
    expect(onExhausted).not.toHaveBeenCalled();
  });

  it('tells the page which server failed', async () => {
    const onServerFailed = jest.fn();
    const { container } = renderPlayer(servers(), { onServerFailed });

    failCurrentServer(container);

    await waitFor(() => expect(onServerFailed).toHaveBeenCalled());
    expect(onServerFailed.mock.calls[0][0]).toMatchObject({ server: 'First' });
  });

  it('clears the switch notice when a server is chosen by hand', async () => {
    const { container } = renderPlayer(servers());
    failCurrentServer(container);
    await screen.findByText(/switched to Second/);

    await userEvent.selectOptions(screen.getByLabelText('Server'), 'Third');

    await waitFor(() =>
      expect(screen.queryByText(/switched to Second/)).not.toBeInTheDocument());
  });
});

/**
 * Two soundtracks at once.
 *
 * Reported from a device: the previous episode's audio kept running under
 * the new one. Destroying the hls instance was not enough - on the native
 * path the element keeps its own src, and an element still holding a loaded
 * source goes on decoding it.
 */
describe('not playing two things at once', () => {
  const first = option({ id: 'a', url: 'https://cdn.test/one.mp4', type: 'mp4' });
  const second = option({ id: 'b', url: 'https://cdn.test/two.mp4', type: 'mp4' });

  it('silences and empties the element when the stream changes', () => {
    const { container, rerender } = renderPlayer([first]);
    const video = container.querySelector('video');

    const pause = jest.spyOn(video, 'pause');
    const load = jest.spyOn(video, 'load');

    rerender(<VideoPlayer streams={{ options: [second] }} title="E1" />);

    expect(pause).toHaveBeenCalled();
    expect(load).toHaveBeenCalled();
  });

  it('drops the old source rather than leaving it attached', () => {
    const { container, rerender } = renderPlayer([first]);
    const video = container.querySelector('video');
    const removeAttribute = jest.spyOn(video, 'removeAttribute');

    rerender(<VideoPlayer streams={{ options: [second] }} title="E1" />);

    expect(removeAttribute).toHaveBeenCalledWith('src');
  });

  it('tidies up the same way when the player goes away entirely', () => {
    const { container, unmount } = renderPlayer([first]);
    const video = container.querySelector('video');
    const pause = jest.spyOn(video, 'pause');

    unmount();

    expect(pause).toHaveBeenCalled();
  });

  /**
   * The attribute fires whenever the element has a source, including a
   * stale one mid-teardown, which was one of the ways two soundtracks ended
   * up running. Play is asked for explicitly instead.
   */
  it('carries no autoPlay attribute', () => {
    const { container } = renderPlayer([first]);
    expect(container.querySelector('video')).not.toHaveAttribute('autoplay');
  });
});


/**
 * Reporting the position, and starting from one.
 *
 * The element cannot be asked where it was: switching server tears the old
 * source down with load(), which resets currentTime to zero before the next
 * attach reads it. That is why the position is kept outside React, and why
 * the code that meant to carry it across a switch never did.
 */
describe('playback position', () => {
  const streams = {
    options: [
      { id: 'a', label: '1080p', server: 'Mega', url: 'https://cdn.test/a.mp4', type: 'mp4' },
      { id: 'b', label: '720p', server: 'Doodstream', url: 'https://cdn.test/b.mp4', type: 'mp4' }
    ]
  };

  /** Moves playback on, as the element does while playing. */
  function playTo(container, seconds, duration = 1440) {
    const video = container.querySelector('video');
    Object.defineProperty(video, 'currentTime', {
      value: seconds, configurable: true, writable: true
    });
    Object.defineProperty(video, 'duration', { value: duration, configurable: true });
    video.dispatchEvent(new Event('timeupdate'));
    return video;
  }

  it('reports where playback has got to', () => {
    const onProgress = jest.fn();
    const { container } = render(
      <VideoPlayer streams={streams} title="Episode 1" mediaKey="/e/1" onProgress={onProgress} />
    );

    playTo(container, 521);

    expect(onProgress).toHaveBeenCalledWith({ position: 521, duration: 1440 });
  });

  // timeupdate fires four times a second; writing to storage that often for
  // something read once per episode would be waste.
  it('does not report on every tick', () => {
    const onProgress = jest.fn();
    const { container } = render(
      <VideoPlayer streams={streams} title="Episode 1" mediaKey="/e/1" onProgress={onProgress} />
    );

    playTo(container, 10);
    playTo(container, 11);
    playTo(container, 12);

    expect(onProgress).toHaveBeenCalledTimes(1);
  });

  // A phone is backgrounded rather than closed, and waiting for the next
  // tick would lose the seconds that decide where you resume.
  it('reports exactly when playback pauses', () => {
    const onProgress = jest.fn();
    const { container } = render(
      <VideoPlayer streams={streams} title="Episode 1" mediaKey="/e/1" onProgress={onProgress} />
    );

    const video = playTo(container, 100);
    onProgress.mockClear();
    video.dispatchEvent(new Event('pause'));

    expect(onProgress).toHaveBeenCalledWith({ position: 100, duration: 1440 });
  });

  it('reports when the page goes away', () => {
    const onProgress = jest.fn();
    const { container } = render(
      <VideoPlayer streams={streams} title="Episode 1" mediaKey="/e/1" onProgress={onProgress} />
    );

    playTo(container, 200);
    onProgress.mockClear();
    window.dispatchEvent(new Event('pagehide'));

    expect(onProgress).toHaveBeenCalledWith({ position: 200, duration: 1440 });
  });

  it('seeks to where the last sitting ended', async () => {
    const { container } = render(
      <VideoPlayer streams={streams} title="Episode 1" mediaKey="/e/1" startAt={300} />
    );

    const video = container.querySelector('video');
    video.dispatchEvent(new Event('loadedmetadata'));

    await waitFor(() => expect(video.currentTime).toBe(300));
  });

  it('starts at the beginning when there is nothing to resume', async () => {
    const { container } = render(
      <VideoPlayer streams={streams} title="Episode 1" mediaKey="/e/1" />
    );

    const video = container.querySelector('video');
    video.dispatchEvent(new Event('loadedmetadata'));

    expect(video.currentTime).toBe(0);
  });

  // The whole reason the position lives outside React.
  it('keeps the position when the server is switched', async () => {
    const { container } = render(
      <VideoPlayer streams={streams} title="Episode 1" mediaKey="/e/1" />
    );

    playTo(container, 400);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Server' }), 'Doodstream');

    const video = container.querySelector('video');
    video.dispatchEvent(new Event('loadedmetadata'));

    await waitFor(() => expect(video.currentTime).toBe(400));
  });

  // Carrying it into the next episode would drop the user into the middle
  // of something they have not seen.
  it('does not carry the position into another episode', async () => {
    const { container, rerender } = render(
      <VideoPlayer streams={streams} title="Episode 1" mediaKey="/e/1" />
    );

    playTo(container, 400);

    // A different episode is a different stream: spreading the same object
    // keeps the same option identities, so the player would not reattach at
    // all and this test would pass without proving anything.
    rerender(
      <VideoPlayer
        streams={{ options: [{ ...streams.options[0], url: 'https://cdn.test/e2.mp4' }] }}
        title="Episode 2"
        mediaKey="/e/2"
      />
    );

    const video = container.querySelector('video');
    Object.defineProperty(video, 'currentTime', { value: 0, writable: true });
    video.dispatchEvent(new Event('loadedmetadata'));

    expect(video.currentTime).toBe(0);
  });
});
