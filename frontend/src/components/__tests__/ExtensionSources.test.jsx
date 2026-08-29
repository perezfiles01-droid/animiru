/**
 * Playing an AniList title from an installed source.
 *
 * The interesting behaviour is all in the seam: a source knows nothing
 * about AniList, so the title has to be matched, and the match has to stay
 * visible and correctable when it is wrong.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ExtensionSources from '../ExtensionSources';
import { getPlaybackProviders } from '../../services/providers/registry';

jest.mock('../../services/providers/registry', () => ({ getPlaybackProviders: jest.fn() }));
// The player needs media APIs jsdom does not implement, and none of what it
// does is under test here.
jest.mock('../VideoPlayer', () => ({ title }) => <div data-testid="player">{title}</div>);

const TITLES = ['Bleach', 'BLEACH', 'ブリーチ'];

function makeProvider(overrides = {}) {
  return {
    id: 'extension:repo#1',
    name: 'Example Source',
    capabilities: ['search', 'playback'],
    resolveByTitle: jest.fn().mockResolvedValue({
      best: { id: '/a/bleach', title: 'Bleach' },
      score: 1,
      confident: true,
      ranked: [{ candidate: { id: '/a/bleach', title: 'Bleach' }, score: 1 }]
    }),
    getEpisodes: jest.fn().mockResolvedValue([
      { id: '/e/1', title: 'Episode 1', number: 1 },
      { id: '/e/2', title: 'Episode 2', number: 2 }
    ]),
    getStreams: jest.fn().mockResolvedValue({
      options: [{ label: '1080p', url: 'https://cdn.test/a.m3u8', type: 'hls', height: 1080 }]
    }),
    ...overrides
  };
}

describe('ExtensionSources', () => {
  beforeEach(() => getPlaybackProviders.mockReset());

  it('points the user at Settings when nothing is installed', () => {
    getPlaybackProviders.mockReturnValue([]);
    render(<ExtensionSources titles={TITLES} />);
    expect(screen.getByText(/Add an extension repository in Settings/)).toBeInTheDocument();
  });

  it('does nothing until a source is chosen', () => {
    const provider = makeProvider();
    getPlaybackProviders.mockReturnValue([provider]);

    render(<ExtensionSources titles={TITLES} />);

    expect(screen.getByRole('button', { name: 'Example Source' })).toBeInTheDocument();
    expect(provider.resolveByTitle).not.toHaveBeenCalled();
  });

  it('matches the title and lists episodes when a source is chosen', async () => {
    const provider = makeProvider();
    getPlaybackProviders.mockReturnValue([provider]);

    render(<ExtensionSources titles={TITLES} />);
    await userEvent.click(screen.getByRole('button', { name: 'Example Source' }));

    expect(await screen.findByText('Episode 1')).toBeInTheDocument();
    expect(provider.resolveByTitle).toHaveBeenCalledWith(TITLES);
    expect(provider.getEpisodes).toHaveBeenCalledWith('/a/bleach');
  });

  it('matches once, not once per render', async () => {
    const provider = makeProvider();
    getPlaybackProviders.mockReturnValue([provider]);

    // The caller passes a fresh array literal every render; collapsing it to
    // a stable value is what stops the match effect looping.
    const { rerender } = render(<ExtensionSources titles={['Bleach', 'BLEACH']} />);
    await userEvent.click(screen.getByRole('button', { name: 'Example Source' }));
    await screen.findByText('Episode 1');

    rerender(<ExtensionSources titles={['Bleach', 'BLEACH']} />);
    rerender(<ExtensionSources titles={['Bleach', 'BLEACH']} />);

    await waitFor(() => expect(provider.resolveByTitle).toHaveBeenCalledTimes(1));
  });

  it('warns when the match is not a close one', async () => {
    const provider = makeProvider({
      resolveByTitle: jest.fn().mockResolvedValue({
        best: { id: '/a/other', title: 'Bleach: Thousand-Year Blood War' },
        score: 0.4,
        confident: false,
        ranked: [
          { candidate: { id: '/a/other', title: 'Bleach: Thousand-Year Blood War' }, score: 0.4 },
          { candidate: { id: '/a/bleach', title: 'Bleach' }, score: 0.3 }
        ]
      })
    });
    getPlaybackProviders.mockReturnValue([provider]);

    render(<ExtensionSources titles={TITLES} />);
    await userEvent.click(screen.getByRole('button', { name: 'Example Source' }));

    expect(await screen.findByText(/not a close match/)).toBeInTheDocument();
  });

  it('lets the user correct a wrong match', async () => {
    const provider = makeProvider({
      resolveByTitle: jest.fn().mockResolvedValue({
        best: { id: '/a/wrong', title: 'Wrong Show' },
        score: 0.4,
        confident: false,
        ranked: [
          { candidate: { id: '/a/wrong', title: 'Wrong Show' }, score: 0.4 },
          { candidate: { id: '/a/right', title: 'Bleach' }, score: 0.3 }
        ]
      })
    });
    getPlaybackProviders.mockReturnValue([provider]);

    render(<ExtensionSources titles={TITLES} />);
    await userEvent.click(screen.getByRole('button', { name: 'Example Source' }));
    await userEvent.click(await screen.findByRole('button', { name: /Wrong title/ }));
    await userEvent.click(screen.getByRole('button', { name: /Bleach\s*30%/ }));

    await waitFor(() => expect(provider.getEpisodes).toHaveBeenLastCalledWith('/a/right'));
  });

  it('reports a source that has nothing matching', async () => {
    const provider = makeProvider({
      resolveByTitle: jest.fn().mockResolvedValue({ best: null, score: 0, confident: false, ranked: [] })
    });
    getPlaybackProviders.mockReturnValue([provider]);

    render(<ExtensionSources titles={TITLES} />);
    await userEvent.click(screen.getByRole('button', { name: 'Example Source' }));

    expect(await screen.findByText(/has nothing matching this title/)).toBeInTheDocument();
    expect(provider.getEpisodes).not.toHaveBeenCalled();
  });

  it('plays an episode', async () => {
    const provider = makeProvider();
    getPlaybackProviders.mockReturnValue([provider]);

    render(<ExtensionSources titles={TITLES} />);
    await userEvent.click(screen.getByRole('button', { name: 'Example Source' }));
    await userEvent.click(await screen.findByText('Episode 2'));

    expect(await screen.findByTestId('player')).toHaveTextContent('Episode 2');
    expect(provider.getStreams).toHaveBeenCalledWith(
      expect.objectContaining({ id: '/e/2' })
    );
  });

  it('says so when a source finds no video', async () => {
    const provider = makeProvider({
      getStreams: jest.fn().mockResolvedValue({ options: [] })
    });
    getPlaybackProviders.mockReturnValue([provider]);

    render(<ExtensionSources titles={TITLES} />);
    await userEvent.click(screen.getByRole('button', { name: 'Example Source' }));
    await userEvent.click(await screen.findByText('Episode 1'));

    expect(await screen.findByText(/found no video/)).toBeInTheDocument();
    expect(screen.queryByTestId('player')).not.toBeInTheDocument();
  });

  it('surfaces a source that fails outright', async () => {
    const provider = makeProvider({
      resolveByTitle: jest.fn().mockRejectedValue(new Error('Extension timed out after 20000ms'))
    });
    getPlaybackProviders.mockReturnValue([provider]);

    render(<ExtensionSources titles={TITLES} />);
    await userEvent.click(screen.getByRole('button', { name: 'Example Source' }));

    expect(await screen.findByText(/Extension timed out/)).toBeInTheDocument();
  });

  it('clears the previous source when another is chosen', async () => {
    const first = makeProvider({ id: 'extension:a', name: 'First' });
    const second = makeProvider({ id: 'extension:b', name: 'Second' });
    getPlaybackProviders.mockReturnValue([first, second]);

    render(<ExtensionSources titles={TITLES} />);
    await userEvent.click(screen.getByRole('button', { name: 'First' }));
    await screen.findByText('Episode 1');

    await userEvent.click(screen.getByRole('button', { name: 'Second' }));

    await waitFor(() => expect(second.resolveByTitle).toHaveBeenCalled());
    expect(await screen.findByText('Episode 1')).toBeInTheDocument();
  });
});
