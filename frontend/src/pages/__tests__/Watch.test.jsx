/**
 * Playing one episode.
 *
 * Resolving a video is the least reliable thing a source does - it usually
 * means loading an episode page and then an embedded host - so the failures
 * are as much the subject here as the success.
 */

import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Watch from '../Watch';
import { getProvider } from '../../services/providers/registry';
import { syncEpisodeProgress } from '../../services/trackers/sync';

// Bound at import, so spying on the module afterwards would not take.
jest.mock('../../services/trackers/sync', () => ({ syncEpisodeProgress: jest.fn() }));

jest.mock('../../services/providers/registry', () => ({ getProvider: jest.fn() }));
// The player needs media APIs jsdom does not implement; none of it is under
// test here, only what it is handed.
jest.mock('../../components/VideoPlayer', () => ({ streams, title }) => (
  <div data-testid="player" data-options={streams.options.length}>{title}</div>
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
      getStreams: jest.fn().mockResolvedValue({ options: [] })
    }));
    await renderWatch();

    expect(screen.getByText(/found no video/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to episodes/ })).toBeInTheDocument();
    expect(screen.queryByTestId('player')).not.toBeInTheDocument();
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
