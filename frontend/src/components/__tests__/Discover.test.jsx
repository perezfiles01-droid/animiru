/**
 * Browsing by season comes from AniList, not from the extensions: a
 * Mangayomi source has no notion of a season, and answering this from the
 * sources would mean implementing a filter in each of them.
 */

import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import Discover, { SEASONS, years } from '../Discover';
import api from '../../services/api';

jest.mock('../../services/api', () => ({ get: jest.fn() }));

const RESULTS = [
  { id: 1, title: 'Mayonaka Heart Tune', poster: 'https://i/1.jpg', format: 'TV', year: 2026 },
  { id: 2, title: 'Another Show', poster: '', format: 'MOVIE', year: 2026 }
];

const show = async () => {
  await act(async () => { render(<MemoryRouter><Discover /></MemoryRouter>); });
};

const open = async () => userEvent.click(screen.getByRole('button', { name: /Discover by season/ }));

describe('discovering by season', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.get.mockResolvedValue({ data: { results: RESULTS, hasNextPage: false } });
  });

  it('offers exactly the seasons asked for, with their months', () => {
    expect(SEASONS.map((s) => s.label)).toEqual([
      'Any Season',
      'Winter (January – March)',
      'Spring (April – June)',
      'Summer (July – September)',
      'Fall / Autumn (October – December)'
    ]);
  });

  // Next season's line-up is announced before it airs.
  it('offers next year as well as this one, newest first', () => {
    const list = years(2026);
    expect(list[0]).toBe(2027);
    expect(list[1]).toBe(2026);
    expect(list[list.length - 1]).toBe(1960);
  });

  // Home must still open straight onto the source's catalogue.
  it('fetches nothing until it is opened', async () => {
    await show();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('fetches nothing until Show is tapped', async () => {
    await show();
    await open();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('asks AniList for the chosen season and year', async () => {
    await show();
    await open();

    await userEvent.selectOptions(screen.getByLabelText('Season'), 'SUMMER');
    await userEvent.selectOptions(screen.getByLabelText('Year'), '2024');
    await userEvent.click(screen.getByRole('button', { name: 'Show' }));

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(api.get.mock.calls[0][1].params).toMatchObject({ season: 'SUMMER', year: 2024 });
  });

  it('lists what it found', async () => {
    await show();
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Show' }));

    expect(await screen.findByText('Mayonaka Heart Tune')).toBeInTheDocument();
    expect(screen.getByText('Another Show')).toBeInTheDocument();
  });

  // AniList has no source id, so a result is a search on your own sources.
  it('links each result to a search across your sources', async () => {
    await show();
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Show' }));

    expect(await screen.findByRole('link', { name: /Mayonaka Heart Tune/ }))
      .toHaveAttribute('href', '/?q=Mayonaka%20Heart%20Tune');
  });

  it('says an empty season is empty', async () => {
    api.get.mockResolvedValue({ data: { results: [], hasNextPage: false } });

    await show();
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Show' }));

    expect(await screen.findByText(/lists nothing for that season/i)).toBeInTheDocument();
  });

  // A failure here is AniList's, not a source's, and saying so stops a
  // working app looking broken.
  it('blames AniList rather than the sources when it fails', async () => {
    api.get.mockRejectedValue(Object.assign(new Error('boom'), {
      response: { data: { error: 'AniList is rate limiting requests.' } }
    }));

    await show();
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Show' }));

    expect(await screen.findByText(/rate limiting/)).toBeInTheDocument();
    expect(screen.getByText(/browsing and\s+playback are unaffected/)).toBeInTheDocument();
  });
});
