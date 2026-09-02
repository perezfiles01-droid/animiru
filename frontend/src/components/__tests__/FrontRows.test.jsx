/**
 * The rows a front page opens with.
 *
 * Continue watching comes from this device, so its cards go straight back to
 * the episode at the position. The other three come from AniList, which
 * knows titles and nothing about your extensions - so those cards can only
 * search your sources by name, which is the honest limit of the idea.
 */

import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import FrontRows, { seasonHeading } from '../FrontRows';
import { getChart } from '../../services/metadata';
import { recordProgress } from '../../services/history';

jest.mock('../../services/metadata', () => ({
  getChart: jest.fn(),
  findOnSourcesHref: (title) => `/?q=${encodeURIComponent(title)}`
}));

const CHART = (name) => ({
  results: [
    { id: 1, title: `${name} one`, poster: 'https://i/1.jpg' },
    { id: 2, title: `${name} two`, poster: '' }
  ]
});

const show = async () => {
  await act(async () => { render(<MemoryRouter><FrontRows /></MemoryRouter>); });
};

const watched = (overrides = {}) => recordProgress({
  providerId: 'extension:repo#1',
  itemId: '/anime/one-piece',
  title: 'One Piece',
  poster: 'https://i.test/op.jpg',
  episodeId: '/e/12',
  episodeTitle: 'Episode 12',
  episodeNumber: 12,
  position: 521,
  duration: 1440,
  ...overrides
});

beforeEach(() => {
  window.localStorage.clear();
  getChart.mockReset();
  getChart.mockImplementation((name) => Promise.resolve(CHART(name)));
});

describe('Continue watching', () => {
  it('lists what was last watched, newest first', async () => {
    watched();
    watched({ itemId: '/anime/bleach', title: 'Bleach' });
    await show();

    const row = screen.getByRole('heading', { name: 'Continue watching' }).parentElement;
    const cards = within(row).getAllByRole('link');

    expect(cards[0]).toHaveTextContent('Bleach');
    expect(cards[1]).toHaveTextContent('One Piece');
  });

  it('says which episode and where it got to', async () => {
    watched();
    await show();

    expect(screen.getByText(/Episode 12 — 8:41/)).toBeInTheDocument();
  });

  // These entries were recorded by the player, so they know exactly where
  // to go - unlike the AniList rows below them.
  it('goes back to that episode at that position', async () => {
    watched();
    await show();

    const link = screen.getByRole('link', { name: /One Piece/ });
    expect(link).toHaveAttribute('href', expect.stringContaining('ep=%2Fe%2F12'));
    expect(link).toHaveAttribute('href', expect.stringContaining('&t=521'));
    expect(link).toHaveAttribute('href', expect.stringContaining('source=extension%3Arepo%231'));
  });

  it('carries the poster, so the card is not blank on arrival', async () => {
    watched();
    await show();

    expect(screen.getByRole('link', { name: /One Piece/ }))
      .toHaveAttribute('href', expect.stringContaining('poster='));
  });

  // A heading over blank space is worse than no row.
  it('is absent entirely when nothing has been watched', async () => {
    await show();
    expect(screen.queryByRole('heading', { name: 'Continue watching' })).not.toBeInTheDocument();
  });
});

describe('the AniList rows', () => {
  it('shows trending, the season and the all-time list', async () => {
    await show();

    await waitFor(() => expect(getChart).toHaveBeenCalledTimes(3));
    expect(getChart.mock.calls.map(([name]) => name)).toEqual(['trending', 'season', 'top']);
  });

  it('names the season it was given rather than guessing', async () => {
    expect(seasonHeading({ season: 'FALL' })).toBe('Top this Fall');
    expect(seasonHeading({ season: 'WINTER' })).toBe('Top this Winter');
  });

  it('falls back to a plain heading when the season is unknown', async () => {
    expect(seasonHeading({})).toBe('Top this season');
  });

  // AniList has no source id, so this is the only thing a card can do.
  it('searches your sources by name', async () => {
    await show();

    const link = await screen.findByRole('link', { name: /trending one/ });
    expect(link).toHaveAttribute('href', '/?q=trending%20one');
  });

  /**
   * One row failing must not empty the others, and must not look like the
   * app is broken - the catalogue below it is unaffected.
   */
  it('blames AniList for a row that fails, and keeps the rest', async () => {
    getChart.mockImplementation((name) => Promise.resolve(
      name === 'trending' ? { results: [], error: 'AniList is rate limiting.' } : CHART(name)
    ));

    await show();

    expect(await screen.findByText(/rate limiting/)).toBeInTheDocument();
    expect(screen.getByText(/This is AniList, not your sources/)).toBeInTheDocument();
    expect(await screen.findByText('season one')).toBeInTheDocument();
  });

  it('shows no heading for a row that came back empty', async () => {
    getChart.mockResolvedValue({ results: [] });
    await show();

    expect(screen.queryByRole('heading', { name: 'Trending now' })).not.toBeInTheDocument();
  });
});
