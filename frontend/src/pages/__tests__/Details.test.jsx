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
      + '&ep=%2Fe%2F2&title=Bleach&poster=https%3A%2F%2Fi.test%2Fb.jpg'
    );
  });

  /**
   * History rows drew an empty placeholder where the poster should be. Not a
   * rendering fault: the poster was never sent. The player is the only place
   * that knows an episode was watched and has nothing else to describe the
   * show with, so the link has to carry it.
   */
  it('carries the poster to the player, so history can draw it', async () => {
    getProvider.mockReturnValue(makeProvider());
    await renderDetails();

    expect(screen.getByRole('link', { name: 'Episode 2' }))
      .toHaveAttribute('href', expect.stringContaining('poster=https%3A%2F%2Fi.test%2Fb.jpg'));
  });

  it('leaves the poster out when the source did not give one', async () => {
    getProvider.mockReturnValue(makeProvider({
      getItem: jest.fn().mockResolvedValue({ id: ITEM, title: 'Bleach', genres: [] })
    }));
    await renderDetails();

    expect(screen.getByRole('link', { name: 'Episode 2' }))
      .toHaveAttribute('href', expect.not.stringContaining('poster='));
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


/**
 * A title you have watched before opens differently.
 *
 * Not a silent resume: someone returning to a show they half-watched a month
 * ago may well want to start it again, and a player that decides for them is
 * what makes people scrub backwards. Both choices are named.
 */
describe('a title that was watched before', () => {
  const { recordProgress } = require('../../services/history');

  beforeEach(() => window.localStorage.clear());

  const watched = (overrides = {}) => recordProgress({
    providerId: SOURCE,
    itemId: ITEM,
    title: 'Bleach',
    episodeId: '/e/2',
    episodeTitle: 'Episode 2',
    episodeNumber: 2,
    position: 521,
    duration: 1440,
    ...overrides
  });

  it('offers to continue the episode that was left', async () => {
    watched();
    getProvider.mockReturnValue(makeProvider());
    await renderDetails();

    expect(await screen.findByText(/You were watching Episode 2/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Continue Episode 2/ })).toBeInTheDocument();
  });

  it('says where it was left, in minutes rather than seconds', async () => {
    watched();
    getProvider.mockReturnValue(makeProvider());
    await renderDetails();

    expect(await screen.findByText(/8:41/)).toBeInTheDocument();
  });

  it('resumes at that position', async () => {
    watched();
    getProvider.mockReturnValue(makeProvider());
    await renderDetails();

    expect(screen.getByRole('link', { name: /Continue Episode 2/ }))
      .toHaveAttribute('href', expect.stringContaining('&t=521'));
  });

  // Without an explicit t=0 the player would find the same entry and resume
  // anyway, making the choice a lie.
  it('starts from the beginning explicitly', async () => {
    watched();
    getProvider.mockReturnValue(makeProvider());
    await renderDetails();

    const link = screen.getByRole('link', { name: /Start from the beginning/ });
    expect(link).toHaveAttribute('href', expect.stringContaining('ep=%2Fe%2F1'));
    expect(link).toHaveAttribute('href', expect.stringContaining('&t=0'));
  });

  // Two primary actions is one too many: the panel already offers both
  // continuing and starting over.
  it('replaces the plain Watch button rather than sitting above it', async () => {
    watched();
    getProvider.mockReturnValue(makeProvider());
    await renderDetails();

    await screen.findByText(/You were watching/);
    expect(screen.queryByRole('link', { name: /▶ Watch Episode 1/ })).not.toBeInTheDocument();
  });

  it('leaves an unwatched title with its plain Watch button', async () => {
    getProvider.mockReturnValue(makeProvider());
    await renderDetails();

    expect(screen.queryByText(/You were watching/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Watch Episode 1/ })).toBeInTheDocument();
  });

  // A finished episode is not resumed into its credits.
  it('offers to watch, not continue, when the episode was finished', async () => {
    watched({ position: 1430 });
    getProvider.mockReturnValue(makeProvider());
    await renderDetails();

    expect(await screen.findByRole('link', { name: /Watch Episode 2/ })).toBeInTheDocument();
    expect(screen.queryByText(/8:41/)).not.toBeInTheDocument();
  });

  describe('watched on another extension', () => {
    const elsewhere = () => recordProgress({
      providerId: 'extension:repo#9',
      providerName: 'AniNeko',
      itemId: '/other/bleach',
      title: 'Bleach',
      episodeId: '/aningeko/e2',
      episodeNumber: 2,
      position: 400,
      duration: 1440
    });

    it('finds the episode by number', async () => {
      elsewhere();
      getProvider.mockReturnValue(makeProvider());
      await renderDetails();

      expect(await screen.findByText(/You were watching Episode 2/)).toBeInTheDocument();
    });

    // An episode number from another source is not necessarily the same
    // episode, so its position is not passed off as this one's.
    it('says where it came from and does not claim a position', async () => {
      elsewhere();
      getProvider.mockReturnValue(makeProvider());
      await renderDetails();

      expect(await screen.findByText(/matched by episode number/)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Watch Episode 2/ }))
        .toHaveAttribute('href', expect.stringContaining('&t=0'));
    });
  });

  it('says nothing when the remembered episode is no longer listed', async () => {
    watched({ episodeId: '/e/99', episodeNumber: 99 });
    getProvider.mockReturnValue(makeProvider());
    await renderDetails();

    expect(screen.queryByText(/You were watching/)).not.toBeInTheDocument();
  });
});
