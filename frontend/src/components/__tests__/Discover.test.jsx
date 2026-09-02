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

/**
 * The filter is applied by the panel now, so a season is a prop rather than
 * something chosen in here. With none applied this renders nothing at all.
 */
const show = async (props = {}) => {
  await act(async () => {
    render(<MemoryRouter><Discover {...props} /></MemoryRouter>);
  });
};

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
  it('renders nothing, and fetches nothing, with no season applied', async () => {
    const { container } = await act(async () => render(
      <MemoryRouter><Discover /></MemoryRouter>
    ));

    expect(api.get).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it('asks AniList for the season and year it was given', async () => {
    await show({ season: 'SUMMER', year: 2024 });

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(api.get.mock.calls[0][1].params).toMatchObject({ season: 'SUMMER', year: 2024 });
  });

  // A page showing one season, with no heading, looks like a page that has
  // lost its catalogue.
  it('says which season is being shown', async () => {
    await show({ season: 'FALL', year: 2026 });
    expect(await screen.findByRole('heading', { name: /Fall \/ Autumn 2026/ }))
      .toBeInTheDocument();
  });

  it('asks again when the applied filter changes', async () => {
    const { rerender } = await act(async () => render(
      <MemoryRouter><Discover season="SUMMER" year={2024} /></MemoryRouter>
    ));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));

    await act(async () => {
      rerender(<MemoryRouter><Discover season="WINTER" year={2024} /></MemoryRouter>);
    });

    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(api.get.mock.calls[1][1].params).toMatchObject({ season: 'WINTER' });
  });

  it('lists what it found', async () => {
    await show({ season: 'SUMMER', year: 2024 });

    expect(await screen.findByText('Mayonaka Heart Tune')).toBeInTheDocument();
    expect(screen.getByText('Another Show')).toBeInTheDocument();
  });

  // AniList has no source id, so a result is a search on your own sources.
  it('links each result to a search across your sources', async () => {
    await show({ season: 'SUMMER', year: 2024 });

    expect(await screen.findByRole('link', { name: /Mayonaka Heart Tune/ }))
      .toHaveAttribute('href', '/?q=Mayonaka%20Heart%20Tune');
  });

  it('says an empty season is empty', async () => {
    api.get.mockResolvedValue({ data: { results: [], hasNextPage: false } });

    await show({ season: 'SUMMER', year: 2024 });

    expect(await screen.findByText(/lists nothing for that season/i)).toBeInTheDocument();
  });

  // A failure here is AniList's, not a source's, and saying so stops a
  // working app looking broken.
  it('blames AniList rather than the sources when it fails', async () => {
    api.get.mockRejectedValue(Object.assign(new Error('boom'), {
      response: { data: { error: 'AniList is rate limiting requests.' } }
    }));

    await show({ season: 'SUMMER', year: 2024 });

    expect(await screen.findByText(/rate limiting/)).toBeInTheDocument();
    expect(screen.getByText(/browsing and\s+playback are unaffected/)).toBeInTheDocument();
  });
});
