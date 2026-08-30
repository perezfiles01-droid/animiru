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

    expect(screen.getByLabelText('Server').querySelectorAll('option')).toHaveLength(2);
  });

  it('names the server and its quality separately', () => {
    renderPlayer([option(), option({ id: 'b', server: 'Doodstream', quality: '720p' })]);
    expect(screen.getByRole('option', { name: 'Doodstream · 720p' })).toBeInTheDocument();
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

  it('toggles on and off', async () => {
    respondWith();
    renderPlayer(withSubs([ENGLISH]));

    const cc = screen.getByRole('button', { name: 'CC' });
    expect(cc).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(cc);
    expect(cc).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(cc);
    expect(cc).toHaveAttribute('aria-pressed', 'false');
  });

  it('fetches through the backend rather than linking the host directly', async () => {
    // Linking directly needs crossOrigin on the video, which would make the
    // browser demand CORS for the video too and stop playback.
    respondWith();
    renderPlayer(withSubs([ENGLISH]));

    await userEvent.click(screen.getByRole('button', { name: 'CC' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(global.fetch.mock.calls[0][0]).toContain('/extensions/subtitle?url=');
  });

  it('turns the subtitle into a blob, which is same-origin', async () => {
    respondWith();
    renderPlayer(withSubs([ENGLISH]));

    await userEvent.click(screen.getByRole('button', { name: 'CC' }));

    await waitFor(() => expect(global.URL.createObjectURL).toHaveBeenCalled());
  });

  it('prefers an English track when the source labelled one', async () => {
    respondWith();
    renderPlayer(withSubs([SPANISH, ENGLISH]));

    await userEvent.click(screen.getByRole('button', { name: 'CC' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(decodeURIComponent(global.fetch.mock.calls[0][0])).toContain('en.vtt');
  });

  it('offers a track list only once subtitles are on and there is a choice', async () => {
    respondWith();
    renderPlayer(withSubs([ENGLISH, SPANISH]));

    expect(screen.queryByLabelText('Subtitles')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'CC' }));
    expect(await screen.findByLabelText('Subtitles')).toBeInTheDocument();
  });

  it('reports why a subtitle could not be loaded, and turns CC back off', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 415,
      json: async () => ({ error: 'ASS subtitles cannot be shown in a browser.' })
    });
    renderPlayer(withSubs([{ url: 'https://cdn.test/subs.ass', label: 'English' }]));

    await userEvent.click(screen.getByRole('button', { name: 'CC' }));

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
    expect(screen.getByRole('option', { name: /First · 1080p \(failed\)/ }))
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

    await userEvent.selectOptions(screen.getByLabelText('Server'), '2');

    await waitFor(() =>
      expect(screen.queryByText(/switched to Second/)).not.toBeInTheDocument());
  });
});
