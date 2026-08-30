/**
 * Playing one episode.
 *
 * Resolving a video is the least reliable thing a source does - it usually
 * means loading an episode page and then an embedded host - so the failures
 * are as much the subject here as the success.
 */

import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Watch from '../Watch';
import { getProvider, getProviders } from '../../services/providers/registry';
import { syncEpisodeProgress } from '../../services/trackers/sync';

// Bound at import, so spying on the module afterwards would not take.
jest.mock('../../services/trackers/sync', () => ({ syncEpisodeProgress: jest.fn() }));

jest.mock('../../services/providers/registry', () => ({
  getProvider: jest.fn(),
  // The source switcher under the player asks for the others.
  getProviders: jest.fn()
}));

// Create React App sets resetMocks, which strips the implementation a mock
// factory gives - so a default has to be set per test, not once at the top.
beforeEach(() => getProviders.mockReturnValue([]));
// The player needs media APIs jsdom does not implement; none of it is under
// test here, only what it is handed.
jest.mock('../../components/VideoPlayer', () => ({ streams, title, startAt, mediaKey, onProgress }) => (
  <div
    data-testid="player"
    data-options={streams.options.length}
    data-start-at={startAt}
    data-media-key={mediaKey}
  >
    {title}
    <button type="button" onClick={() => onProgress({ position: 521, duration: 1440 })}>
      report progress
    </button>
  </div>
));

const SOURCE = 'extension:repo#1';
const ITEM = '/anime/bleach';
const PATH = `/watch?source=${encodeURIComponent(SOURCE)}`
  + `&id=${encodeURIComponent(ITEM)}&ep=${encodeURIComponent('/e/1')}`;

function makeProvider(overrides = {}) {
  return {
    id: SOURCE,
    name: 'Example Source',
    getEpisodes: jest.fn().mockResolvedValue([
      { id: '/e/1', providerId: SOURCE, title: 'Episode 1', number: 1 },
      { id: '/e/2', providerId: SOURCE, title: 'Episode 2', number: 2 }
    ]),
    getStreams: jest.fn().mockResolvedValue({
      options: [
        { label: '1080p', url: 'https://cdn.test/a.m3u8', type: 'hls', height: 1080 },
        { label: '720p', url: 'https://cdn.test/b.m3u8', type: 'hls', height: 720 }
      ]
    }),
    ...overrides
  };
}

async function renderWatch(path = PATH) {
  await act(async () => {
    render(<MemoryRouter initialEntries={[path]}><Watch /></MemoryRouter>);
  });
}

describe('Watch', () => {
  beforeEach(() => getProvider.mockReset());

  it('plays the episode it was asked for', async () => {
    const provider = makeProvider();
    getProvider.mockReturnValue(provider);
    await renderWatch();

    expect(screen.getByTestId('player')).toHaveTextContent('Episode 1');
    expect(provider.getStreams).toHaveBeenCalledWith('/e/1');
  });

  it('hands the player every quality the source returned', async () => {
    getProvider.mockReturnValue(makeProvider());
    await renderWatch();

    expect(screen.getByTestId('player')).toHaveAttribute('data-options', '2');
  });

  it('lets you switch episode without going back', async () => {
    const provider = makeProvider();
    getProvider.mockReturnValue(provider);
    await renderWatch();

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Episode 2' }));
    });

    expect(provider.getStreams).toHaveBeenLastCalledWith('/e/2');
  });

  it('says so when the source finds no video, and offers a way back', async () => {
    getProvider.mockReturnValue(makeProvider({
      getStreams: jest.fn().mockRejectedValue(new Error('This source found no video for that episode.'))
    }));
    await renderWatch();

    expect(screen.getByText(/found no video/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to episodes/ })).toBeInTheDocument();
    expect(screen.queryByTestId('player')).not.toBeInTheDocument();
  });

  /**
   * An empty result carries a request trace now, and it is the whole
   * answer: a 403 above "found no video" means the site blocked the fetch,
   * not that the source needs rewriting. Reports of this were previously
   * unanswerable because the sentence was all there was.
   */
  describe('when a source finds no video', () => {
    function emptyWithTrace() {
      const error = new Error('This source found no video for that episode.');
      error.diagnostics = {
        message: error.message,
        method: 'getVideoList',
        source: { name: 'Example Source', version: '1.0.0' },
        cause: 'The source ran without failing and returned no servers at all.',
        fix: 'Check the requests below.',
        requests: [
          { method: 'GET', url: 'https://site.test/e/1', status: 403, durationMs: 40 }
        ],
        failedRequests: [
          { method: 'GET', url: 'https://site.test/e/1', status: 403, durationMs: 40 }
        ],
        logs: []
      };
      return makeProvider({ getStreams: jest.fn().mockRejectedValue(error) });
    }

    it('explains the cause rather than only stating the symptom', async () => {
      getProvider.mockReturnValue(emptyWithTrace());
      await renderWatch();

      expect(screen.getByText(/returned no servers at all/)).toBeInTheDocument();
    });

    it('points at the failed request, which is usually the real cause', async () => {
      getProvider.mockReturnValue(emptyWithTrace());
      await renderWatch();

      expect(screen.getByText(/403/)).toBeInTheDocument();
    });

    it('shows the requests the source made when asked for details', async () => {
      getProvider.mockReturnValue(emptyWithTrace());
      await renderWatch();

      await userEvent.click(screen.getByRole('button', { name: /Show details/ }));
      expect(screen.getByText('https://site.test/e/1')).toBeInTheDocument();
    });

    // The way out of a dead source is another source, and it was only
    // offered below the error where it is easy to miss.
    it('offers the source switcher from the error itself', async () => {
      getProviders.mockReturnValue([
        { id: SOURCE, name: 'Example Source' },
        { id: 'extension:repo#2', name: 'Other Source' }
      ]);
      getProvider.mockReturnValue(emptyWithTrace());
      await renderWatch();

      // Scoped to the error block: the same switcher sits further down the
      // page beside the episode list, so an unscoped query passes whether
      // or not the error offers one.
      const block = screen.getByText(/returned no servers at all/).closest('.watch-error');
      expect(within(block).getByRole('button', { name: /Example Source/ })).toBeInTheDocument();
    });
  });

  it('still plays when the episode list fails to load', async () => {
    // The list is a convenience; losing it must not cost the user the
    // episode they actually asked for.
    getProvider.mockReturnValue(makeProvider({
      getEpisodes: jest.fn().mockRejectedValue(new Error('nope'))
    }));
    await renderWatch();

    expect(screen.getByTestId('player')).toBeInTheDocument();
  });

  it('surfaces a source that fails to resolve video', async () => {
    getProvider.mockReturnValue(makeProvider({
      getStreams: jest.fn().mockRejectedValue(new Error('Extension timed out after 20000ms'))
    }));
    await renderWatch();

    expect(screen.getByText(/Extension timed out/)).toBeInTheDocument();
  });

  it('explains an uninstalled source', async () => {
    getProvider.mockReturnValue(null);
    await renderWatch();

    expect(screen.getByText(/not installed any more/)).toBeInTheDocument();
  });
});

/**
 * The player showed only "Episode 1" and the source's name, which is not
 * enough to tell what you are watching. The same missing value is what
 * tracking matches on, so every progress update searched AniList for an
 * empty title, matched nothing, and did nothing.
 */
describe('knowing what is being watched', () => {
  beforeEach(() => syncEpisodeProgress.mockClear());

  it('shows the show name above the episode', async () => {
    getProvider.mockReturnValue(makeProvider());
    await renderWatch('/watch?source=extension%3Arepo%231&id=%2Fa%2F1&ep=%2Fe%2F1'
      + '&title=Mushoku%20Tensei');

    expect(screen.getByRole('heading', { level: 1, name: 'Mushoku Tensei' }))
      .toBeInTheDocument();
    expect(screen.getAllByText('Episode 1').length).toBeGreaterThan(0);
  });

  it('still shows the episode when no show name was passed', async () => {
    getProvider.mockReturnValue(makeProvider());
    await renderWatch('/watch?source=extension%3Arepo%231&id=%2Fa%2F1&ep=%2Fe%2F1');

    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.getAllByText('Episode 1').length).toBeGreaterThan(0);
  });

  // Tracking matches AniList on this, so an empty title meant no sync at all.
  it('gives tracking the title to match on', async () => {
    getProvider.mockReturnValue(makeProvider());

    await renderWatch('/watch?source=extension%3Arepo%231&id=%2Fa%2F1&ep=%2Fe%2F1'
      + '&title=Mushoku%20Tensei');

    await waitFor(() => expect(syncEpisodeProgress).toHaveBeenCalled());
    expect(syncEpisodeProgress.mock.calls[0][0]).toMatchObject({ title: 'Mushoku Tensei' });
  });
});


/**
 * Recording where the user got to, and starting there next time.
 *
 * The player knows the position and the page knows what is being played, so
 * this is the only place that can write a history entry.
 */
describe('remembering the position', () => {
  const { getHistory, recordProgress } = require('../../services/history');

  beforeEach(() => window.localStorage.clear());

  it('records the episode and position while it plays', async () => {
    getProvider.mockReturnValue(makeProvider());
    await renderWatch(`${PATH}&title=One%20Piece`);

    await userEvent.click(screen.getByRole('button', { name: /report progress/ }));

    expect(getHistory()[0]).toMatchObject({
      title: 'One Piece',
      providerId: SOURCE,
      itemId: ITEM,
      episodeId: '/e/1',
      position: 521,
      duration: 1440
    });
  });

  it('names the source, so the history row can say where it played', async () => {
    getProvider.mockReturnValue(makeProvider());
    await renderWatch(`${PATH}&title=One%20Piece`);

    await userEvent.click(screen.getByRole('button', { name: /report progress/ }));
    expect(getHistory()[0].providerName).toBe('Example Source');
  });

  it('starts the episode where it was left', async () => {
    recordProgress({
      providerId: SOURCE, itemId: ITEM, title: 'One Piece',
      episodeId: '/e/1', position: 300, duration: 1440
    });

    getProvider.mockReturnValue(makeProvider());
    await renderWatch();

    expect(screen.getByTestId('player')).toHaveAttribute('data-start-at', '300');
  });

  // Without this, "Start from the beginning" would silently resume.
  it('starts at the beginning when the link says to', async () => {
    recordProgress({
      providerId: SOURCE, itemId: ITEM, title: 'One Piece',
      episodeId: '/e/1', position: 300, duration: 1440
    });

    getProvider.mockReturnValue(makeProvider());
    await renderWatch(`${PATH}&t=0`);

    expect(screen.getByTestId('player')).toHaveAttribute('data-start-at', '0');
  });

  it('starts a different episode from the beginning', async () => {
    recordProgress({
      providerId: SOURCE, itemId: ITEM, title: 'One Piece',
      episodeId: '/e/2', position: 300, duration: 1440
    });

    getProvider.mockReturnValue(makeProvider());
    await renderWatch();

    expect(screen.getByTestId('player')).toHaveAttribute('data-start-at', '0');
  });

  // The player keys its own reset on this: without it a position carries
  // from one episode into the next.
  it('tells the player which episode it is playing', async () => {
    getProvider.mockReturnValue(makeProvider());
    await renderWatch();

    expect(screen.getByTestId('player')).toHaveAttribute('data-media-key', '/e/1');
  });
});
