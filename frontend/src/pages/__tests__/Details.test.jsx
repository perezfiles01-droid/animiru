/**
 * A title as its source describes it.
 *
 * A scraper's detail page is thinner and less reliable than a metadata API,
 * so most of what matters here is what the page does when a field is
 * missing, when the source fails, or when the source is gone entirely.
 */

import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Details from '../Details';
import { getProvider } from '../../services/providers/registry';

jest.mock('../../services/providers/registry', () => ({ getProvider: jest.fn() }));

const SOURCE = 'extension:repo#1';
const ITEM = '/anime/bleach';
const PATH = `/anime?source=${encodeURIComponent(SOURCE)}&id=${encodeURIComponent(ITEM)}`;

function makeProvider(overrides = {}) {
  return {
    id: SOURCE,
    name: 'Example Source',
    getItem: jest.fn().mockResolvedValue({
      id: ITEM,
      providerId: SOURCE,
      title: 'Bleach',
      poster: 'https://i.test/b.jpg',
      overview: 'A boy who can see ghosts.',
      genres: ['Action', 'Supernatural']
    }),
    getEpisodes: jest.fn().mockResolvedValue([
      { id: '/e/1', providerId: SOURCE, title: 'Episode 1', number: 1 },
      { id: '/e/2', providerId: SOURCE, title: 'Episode 2', number: 2 }
    ]),
    ...overrides
  };
}

async function renderDetails(path = PATH) {
  await act(async () => {
    render(<MemoryRouter initialEntries={[path]}><Details /></MemoryRouter>);
  });
}

describe('Details', () => {
  beforeEach(() => getProvider.mockReset());

  it('shows what the source knows about the title', async () => {
    getProvider.mockReturnValue(makeProvider());
    await renderDetails();

    expect(screen.getByRole('heading', { name: 'Bleach' })).toBeInTheDocument();
    expect(screen.getByText('A boy who can see ghosts.')).toBeInTheDocument();
    expect(screen.getByText('Action')).toBeInTheDocument();
    expect(screen.getByText('Example Source')).toBeInTheDocument();
  });

  it('lists the episodes and links each to the player', async () => {
    getProvider.mockReturnValue(makeProvider());
    await renderDetails();

    expect(screen.getByText('2 episodes')).toBeInTheDocument();
    // The show's name travels with the link: the player has nothing else
    // to identify what is being watched, and tracking matches AniList on it.
    expect(screen.getByRole('link', { name: 'Episode 2' })).toHaveAttribute(
      'href',
      `/watch?source=${encodeURIComponent(SOURCE)}&id=${encodeURIComponent(ITEM)}`
      + '&ep=%2Fe%2F2&title=Bleach'
    );
  });

  it('offers the first episode as the main action', async () => {
    getProvider.mockReturnValue(makeProvider());
    await renderDetails();

    expect(screen.getByRole('link', { name: /Watch Episode 1/ })).toBeInTheDocument();
  });

  it('omits a synopsis the source did not supply, rather than an empty heading', async () => {
    getProvider.mockReturnValue(makeProvider({
      getItem: jest.fn().mockResolvedValue({ id: ITEM, title: 'Bleach', genres: [] })
    }));
    await renderDetails();

    expect(screen.queryByText('Synopsis')).not.toBeInTheDocument();
  });

  it('says so when a source lists no episodes', async () => {
    getProvider.mockReturnValue(makeProvider({
      getEpisodes: jest.fn().mockResolvedValue([])
    }));
    await renderDetails();

    expect(screen.getByText(/listed no episodes/)).toBeInTheDocument();
  });

  it('explains an uninstalled source instead of failing blankly', async () => {
    getProvider.mockReturnValue(null);
    await renderDetails();

    expect(screen.getByText(/not installed any more/)).toBeInTheDocument();
  });

  it('surfaces a source that fails', async () => {
    getProvider.mockReturnValue(makeProvider({
      getItem: jest.fn().mockRejectedValue(new Error('Extension timed out after 20000ms'))
    }));
    await renderDetails();

    expect(screen.getByText(/Extension timed out/)).toBeInTheDocument();
  });
});

/**
 * AnimeParadise's getDetail built its object without ever setting a name,
 * so a title that read correctly in the browse list opened as "Untitled".
 * The source is fixed, but any source can omit it - and the app already
 * knows the name from the card that was tapped.
 */
describe('a source that returns no title', () => {
  const nameless = () => makeProvider({
    getItem: jest.fn().mockResolvedValue({
      id: ITEM, providerId: SOURCE, title: 'Untitled', poster: 'p', genres: [], overview: 'x'
    })
  });

  it('falls back to the name the card knew', async () => {
    getProvider.mockReturnValue(nameless());
    await renderDetails(`/anime?source=${encodeURIComponent(SOURCE)}`
      + `&id=${encodeURIComponent(ITEM)}&title=Takt%20Op.`);

    expect(await screen.findByRole('heading', { name: 'Takt Op.' })).toBeInTheDocument();
    expect(screen.queryByText('Untitled')).not.toBeInTheDocument();
  });

  it('carries that name on to the player as well', async () => {
    getProvider.mockReturnValue(nameless());
    await renderDetails(`/anime?source=${encodeURIComponent(SOURCE)}`
      + `&id=${encodeURIComponent(ITEM)}&title=Takt%20Op.`);

    const link = await screen.findByRole('link', { name: /Watch Episode 1/ });
    expect(link.getAttribute('href')).toContain('title=Takt%20Op.');
  });

  // Only right when nothing anywhere knew the title.
  it('still says Untitled when nothing knew the name', async () => {
    getProvider.mockReturnValue(nameless());
    await renderDetails(`/anime?source=${encodeURIComponent(SOURCE)}&id=${encodeURIComponent(ITEM)}`);

    expect(await screen.findByRole('heading', { name: 'Untitled' })).toBeInTheDocument();
  });

  it('prefers the source when it does return a name', async () => {
    getProvider.mockReturnValue(makeProvider());
    await renderDetails(`/anime?source=${encodeURIComponent(SOURCE)}`
      + `&id=${encodeURIComponent(ITEM)}&title=Something%20Else`);

    expect(await screen.findByRole('heading', { name: 'Bleach' })).toBeInTheDocument();
  });
});
