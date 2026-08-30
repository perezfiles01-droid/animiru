/**
 * Watch order and recommendations share a shell: both work out which
 * AniList entry a source's title refers to, fetch one thing about it, and
 * let a wrong match be corrected. These cover that shared path once through
 * Watch order, and the drawing of each screen separately.
 */

import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import WatchOrder from '../WatchOrder';
import Recommendations from '../Recommendations';
import api from '../../services/api';
import { getSavedMatch } from '../../services/metadata';

jest.mock('../../services/api', () => ({ get: jest.fn() }));

const MATCH = {
  id: 1, title: 'Mayonaka Heart Tune', format: 'TV', year: 2026,
  poster: 'https://i.test/1.jpg', titles: ['Mayonaka Heart Tune', 'Tune In to the Midnight Heart']
};

const ORDER = [
  { id: 3, position: 1, title: 'The Movie', format: 'MOVIE', year: 2025, poster: '', titles: [] },
  { id: 1, position: 2, title: 'Mayonaka Heart Tune', format: 'TV', episodes: 12, year: 2026, poster: '', titles: [] },
  { id: 2, position: 3, title: '2nd Season', format: 'TV', year: 2027, poster: '', titles: [] }
];

const route = '/watch-order?source=extension:a&id=/x&title=Tune%20In%20to%20the%20Midnight%20Heart';

function routes({ search = { results: [MATCH] }, order = { entries: ORDER }, recs = null }) {
  api.get.mockImplementation(async (path) => {
    if (path.endsWith('/search')) return { data: search };
    if (path.endsWith('/watch-order')) return { data: order };
    return { data: recs || { results: [] } };
  });
}

const show = async (element, path = route) => {
  await act(async () => {
    render(<MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>);
  });
};

describe('the Watch order screen', () => {
  beforeEach(() => { window.localStorage.clear(); api.get.mockReset(); });

  it('numbers the franchise from the oldest', async () => {
    routes({});
    await show(<WatchOrder />);

    const entries = screen.getAllByRole('listitem');
    expect(entries[0]).toHaveTextContent('The Movie');
    expect(entries[0]).toHaveTextContent('1');
    expect(entries[2]).toHaveTextContent('2nd Season');
  });

  it('shows format, episode count and year', async () => {
    routes({});
    await show(<WatchOrder />);

    expect(screen.getByText(/TV \| 12 eps \| 2026/)).toBeInTheDocument();
  });

  it('says an entry has not aired rather than leaving the year blank', async () => {
    routes({ order: { entries: [{ id: 9, position: 1, title: 'Announced', format: 'TV', year: null, titles: [] }] } });
    await show(<WatchOrder />);

    expect(screen.getByText(/unaired/)).toBeInTheDocument();
  });

  // A wrong match looks like it worked: the screen is simply about another
  // show. Naming the entry is what makes that visible.
  it('names the AniList entry it matched', async () => {
    routes({});
    await show(<WatchOrder />);

    expect(screen.getByText(/Showing results for/)).toHaveTextContent('Mayonaka Heart Tune');
  });

  it('offers to correct the match, and remembers the correction', async () => {
    const other = { id: 42, title: 'A Different Show', format: 'TV', year: 2019, poster: '' };
    routes({ search: { results: [MATCH, other] } });
    await show(<WatchOrder />);

    await userEvent.click(screen.getByRole('button', { name: /Wrong show/i }));
    await userEvent.click(screen.getByRole('button', { name: /A Different Show/ }));

    await waitFor(() => expect(getSavedMatch('extension:a', '/x')).toBe(42));
  });

  it('uses a correction made earlier without asking again', async () => {
    routes({ search: { results: [MATCH, { id: 42, title: 'A Different Show' }] } });

    window.localStorage.setItem(
      'animiru.anilistMatches', JSON.stringify({ 'extension:a:/x': 42 })
    );

    await show(<WatchOrder />);

    await waitFor(() => {
      expect(screen.getByText(/Showing results for/)).toHaveTextContent('A Different Show');
    });
    expect(screen.getByText(/your choice/)).toBeInTheDocument();
  });

  it('explains a title AniList does not know, rather than showing nothing', async () => {
    routes({ search: { results: [] } });
    await show(<WatchOrder />);

    expect(screen.getByText(/Nothing on AniList matched/)).toBeInTheDocument();
  });

  // Metadata failing is not the source failing.
  it('says the title still works when AniList is unreachable', async () => {
    api.get.mockImplementation(async (path) => {
      if (path.endsWith('/search')) return { data: { results: [MATCH] } };
      throw Object.assign(new Error('boom'), {
        response: { data: { error: 'AniList is rate limiting requests.' } }
      });
    });

    await show(<WatchOrder />);

    expect(screen.getByText(/rate limiting/)).toBeInTheDocument();
    expect(screen.getByText(/The title itself still works/)).toBeInTheDocument();
  });

  it('says so when the story has nothing else in it', async () => {
    routes({ order: { entries: [] } });
    await show(<WatchOrder />);

    expect(screen.getByText(/nothing else in this story/i)).toBeInTheDocument();
  });

  it('offers the way back to the title', async () => {
    routes({});
    await show(<WatchOrder />);

    expect(screen.getByRole('link', { name: /Back/i }))
      .toHaveAttribute('href', '/anime?source=extension%3Aa&id=%2Fx');
  });
});

describe('the Recommendations screen', () => {
  beforeEach(() => { window.localStorage.clear(); api.get.mockReset(); });

  const RECS = [{
    id: 5, title: 'The Quintessential Quintuplets', percent: 76,
    description: 'Uesugi Fuutarou, a high school second-year.',
    genres: ['Comedy', 'Drama', 'Romance'], poster: 'https://i.test/q.jpg'
  }];

  it('shows the percentage, synopsis and genres', async () => {
    api.get.mockImplementation(async (path) => {
      if (path.endsWith('/search')) return { data: { results: [MATCH] } };
      return { data: { results: RECS } };
    });

    await show(<Recommendations />, '/recommendations?source=extension:a&id=/x&title=Heart');

    expect(screen.getByText('76%')).toBeInTheDocument();
    expect(screen.getByText(/Uesugi Fuutarou/)).toBeInTheDocument();
    expect(screen.getByText('Comedy')).toBeInTheDocument();
  });

  it('leaves out the percentage when there is nothing to compare', async () => {
    api.get.mockImplementation(async (path) => {
      if (path.endsWith('/search')) return { data: { results: [MATCH] } };
      return { data: { results: [{ ...RECS[0], percent: null }] } };
    });

    await show(<Recommendations />, '/recommendations?source=extension:a&id=/x&title=Heart');

    expect(screen.queryByText(/%$/)).not.toBeInTheDocument();
  });

  it('says so when there are none yet', async () => {
    api.get.mockImplementation(async (path) => {
      if (path.endsWith('/search')) return { data: { results: [MATCH] } };
      return { data: { results: [] } };
    });

    await show(<Recommendations />, '/recommendations?source=extension:a&id=/x&title=Heart');

    expect(screen.getByText(/no recommendations for this title yet/i)).toBeInTheDocument();
  });
});

/**
 * AniList entries carry no source id - they are not from a source at all -
 * so there is nothing to link straight to. Tapping one searches for the
 * title on the source the reader came from, which is the one already in use
 * and the one that can actually play it.
 */
describe('finding a suggested title on your own sources', () => {
  beforeEach(() => { window.localStorage.clear(); api.get.mockReset(); });

  it('links the watch order poster and title to a scoped search', async () => {
    routes({});
    await show(<WatchOrder />);

    const links = screen.getAllByRole('link', { name: /Find The Movie on your sources|The Movie/ });
    for (const link of links) {
      expect(link).toHaveAttribute(
        'href', '/?q=The%20Movie&source=extension%3Aa'
      );
    }
    expect(links.length).toBeGreaterThanOrEqual(2);
  });

  it('links a recommendation the same way', async () => {
    api.get.mockImplementation(async (path) => {
      if (path.endsWith('/search')) return { data: { results: [MATCH] } };
      return { data: { results: [{ id: 5, title: 'Nisekoi', percent: 73, genres: [], poster: 'p' }] } };
    });

    await show(<Recommendations />, '/recommendations?source=extension:a&id=/x&title=Heart');

    expect(screen.getByRole('link', { name: 'Nisekoi' }))
      .toHaveAttribute('href', '/?q=Nisekoi&source=extension%3Aa');
  });

  // Discover has no originating source, and goes through the same path.
  it('searches every source when there is no source to scope to', async () => {
    routes({});
    await show(<WatchOrder />, '/watch-order?id=/x&title=Heart');

    expect(screen.getByRole('link', { name: 'The Movie' }))
      .toHaveAttribute('href', '/?q=The%20Movie');
  });
});
