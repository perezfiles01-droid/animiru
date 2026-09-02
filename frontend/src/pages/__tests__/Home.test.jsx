/**
 * The page the app opens on.
 *
 * The behaviour that matters: something is on screen without the user
 * clicking anything, and when there is nothing to show, the reason is
 * obvious and actionable.
 */

import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Home from '../Home';
import { getProviders } from '../../services/providers/registry';
import * as storage from '../../services/extensions/storage';

jest.mock('../../services/providers/registry', () => ({ getProviders: jest.fn() }));

function makeProvider(overrides = {}) {
  return {
    id: 'extension:repo#1',
    name: 'Example Source',
    sourceKey: 'repo#1',
    capabilities: ['search', 'library', 'playback'],
    getLibrary: jest.fn().mockResolvedValue([
      { id: '/a/1', providerId: 'extension:repo#1', title: 'Bleach', poster: 'https://i.test/b.jpg' },
      { id: '/a/2', providerId: 'extension:repo#1', title: 'Naruto' }
    ]),
    search: jest.fn().mockResolvedValue([
      { id: '/a/1', providerId: 'extension:repo#1', title: 'Bleach' }
    ]),
    ...overrides
  };
}

/**
 * Renders and waits for the first load to finish.
 *
 * Home fetches on mount, so a test that asserts before that settles leaves
 * React applying an update after the test body has ended - which is what
 * "not wrapped in act(...)" is reporting. Waiting here once keeps every test
 * below honest without each of them repeating it.
 */
async function renderHome(path = '/') {
  let result;
  // The mocked source resolves in the microtask straight after mount, so the
  // resulting state update lands before any waitFor could wrap it. Wrapping
  // the render itself is what puts that first flush inside act().
  await act(async () => {
    result = render(<MemoryRouter initialEntries={[path]}><Home /></MemoryRouter>);
  });
  return result;
}

describe('Home', () => {
  beforeEach(() => {
    window.localStorage.clear();
    getProviders.mockReset();
  });

  it('sends you to Settings when nothing is installed', async () => {
    getProviders.mockReturnValue([]);
    await renderHome();

    expect(screen.getByText('No sources installed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open Settings/ })).toHaveAttribute('href', '/settings');
  });

  it('loads the catalogue on open, with no click needed', async () => {
    const provider = makeProvider();
    getProviders.mockReturnValue([provider]);

    await renderHome();

    expect(await screen.findByText('Bleach')).toBeInTheDocument();
    expect(screen.getByText('Naruto')).toBeInTheDocument();
    expect(provider.getLibrary).toHaveBeenCalledWith(1);
  });

  it('links a card to that source and item', async () => {
    getProviders.mockReturnValue([makeProvider()]);
    await renderHome();

    const link = (await screen.findByText('Bleach')).closest('a');
    // The title rides along: a source whose getDetail returns no name would
    // otherwise open as "Untitled" despite the card knowing what it is.
    expect(link).toHaveAttribute(
      'href',
      '/anime?source=extension%3Arepo%231&id=%2Fa%2F1&title=Bleach'
    );
  });

  it('searches when a query is in the URL, and does not fetch the catalogue', async () => {
    const provider = makeProvider();
    getProviders.mockReturnValue([provider]);

    await renderHome('/?q=bleach');

    await waitFor(() => expect(provider.search).toHaveBeenCalledWith('bleach', 1));
    expect(provider.getLibrary).not.toHaveBeenCalled();
    expect(screen.getByText(/Results for/)).toBeInTheDocument();
  });

  describe('searching every source at once', () => {
    it('asks all of them, not just the selected one', async () => {
      const first = makeProvider({ id: 'extension:a', name: 'First', sourceKey: 'a' });
      const second = makeProvider({ id: 'extension:b', name: 'Second', sourceKey: 'b' });
      getProviders.mockReturnValue([first, second]);

      await renderHome('/?q=bleach');

      // The hassle this removes: picking a source, searching, repeating.
      await waitFor(() => expect(first.search).toHaveBeenCalledWith('bleach', 1));
      await waitFor(() => expect(second.search).toHaveBeenCalledWith('bleach', 1));
    });

    it('groups the results under the source that returned them', async () => {
      const first = makeProvider({
        id: 'extension:a',
        name: 'First',
        sourceKey: 'a',
        search: jest.fn().mockResolvedValue([
          { id: '/1', providerId: 'extension:a', title: 'From First' }
        ])
      });
      const second = makeProvider({
        id: 'extension:b',
        name: 'Second',
        sourceKey: 'b',
        search: jest.fn().mockResolvedValue([
          { id: '/2', providerId: 'extension:b', title: 'From Second' }
        ])
      });
      getProviders.mockReturnValue([first, second]);

      await renderHome('/?q=bleach');

      expect(await screen.findByRole('heading', { name: 'First' })).toBeInTheDocument();
      expect(await screen.findByRole('heading', { name: 'Second' })).toBeInTheDocument();
      expect(screen.getByText('From First')).toBeInTheDocument();
      expect(screen.getByText('From Second')).toBeInTheDocument();
    });

    it('shows a failing source in its own row without emptying the page', async () => {
      const working = makeProvider({
        id: 'extension:a',
        name: 'Working',
        sourceKey: 'a',
        search: jest.fn().mockResolvedValue([
          { id: '/1', providerId: 'extension:a', title: 'Still here' }
        ])
      });
      const broken = makeProvider({
        id: 'extension:b',
        name: 'Broken',
        sourceKey: 'b',
        search: jest.fn().mockRejectedValue(new Error('Extension timed out after 20000ms'))
      });
      getProviders.mockReturnValue([working, broken]);

      await renderHome('/?q=bleach');

      expect(await screen.findByText('Still here')).toBeInTheDocument();
      expect(await screen.findByText(/Extension timed out/)).toBeInTheDocument();
    });

    it('says when nothing at all was found', async () => {
      const provider = makeProvider({ search: jest.fn().mockResolvedValue([]) });
      getProviders.mockReturnValue([provider]);

      await renderHome('/?q=zzzz');

      expect(await screen.findByText(/Nothing found for/)).toBeInTheDocument();
    });

    it('narrows to one source when a group is followed', async () => {
      const first = makeProvider({ id: 'extension:a', name: 'First', sourceKey: 'a' });
      const second = makeProvider({ id: 'extension:b', name: 'Second', sourceKey: 'b' });
      getProviders.mockReturnValue([first, second]);

      await renderHome('/?q=bleach&source=extension%3Ab');

      await waitFor(() => expect(second.search).toHaveBeenCalled());
      expect(first.search).not.toHaveBeenCalled();
    });

    it('hides the source tabs during a search, since every source is used', async () => {
      const first = makeProvider({ id: 'extension:a', name: 'First', sourceKey: 'a' });
      const second = makeProvider({ id: 'extension:b', name: 'Second', sourceKey: 'b' });
      getProviders.mockReturnValue([first, second]);

      await renderHome('/?q=bleach');

      expect(screen.queryByRole('button', { name: 'First' })).not.toBeInTheDocument();
    });
  });

  it('searches from the box', async () => {
    const provider = makeProvider();
    getProviders.mockReturnValue([provider]);
    await renderHome();
    await screen.findByText('Bleach');

    await userEvent.type(screen.getByLabelText('Search'), 'naruto');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(provider.search).toHaveBeenCalledWith('naruto', 1));
  });

  it('browses the selected source, and only that one', async () => {
    const first = makeProvider({ id: 'extension:a', name: 'First', sourceKey: 'a' });
    const second = makeProvider({ id: 'extension:b', name: 'Second', sourceKey: 'b' });
    getProviders.mockReturnValue([first, second]);

    await renderHome();

    // Catalogues have no shared ranking, so merging them is not honest.
    expect(first.getLibrary).toHaveBeenCalled();
    expect(second.getLibrary).not.toHaveBeenCalled();
  });

  it('appends the next page rather than replacing what is shown', async () => {
    const provider = makeProvider();
    provider.getLibrary
      .mockResolvedValueOnce([{ id: '/a/1', providerId: 'x', title: 'First' }])
      .mockResolvedValueOnce([{ id: '/a/2', providerId: 'x', title: 'Second' }]);
    getProviders.mockReturnValue([provider]);

    await renderHome();
    await userEvent.click(await screen.findByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('Second')).toBeInTheDocument();
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(provider.getLibrary).toHaveBeenLastCalledWith(2);
  });

  it('stops offering more when a page comes back empty', async () => {
    const provider = makeProvider({ getLibrary: jest.fn().mockResolvedValue([]) });
    getProviders.mockReturnValue([provider]);

    await renderHome();

    expect(await screen.findByText(/returned no titles/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('reports a source that fails', async () => {
    const provider = makeProvider({
      getLibrary: jest.fn().mockRejectedValue(new Error('Extension timed out after 20000ms'))
    });
    getProviders.mockReturnValue([provider]);

    await renderHome();

    expect(await screen.findByText(/Extension timed out/)).toBeInTheDocument();
  });

  describe('with several sources', () => {
    it('offers tabs and remembers the one you pick', async () => {
      const first = makeProvider({ id: 'extension:a', name: 'First', sourceKey: 'a' });
      const second = makeProvider({ id: 'extension:b', name: 'Second', sourceKey: 'b' });
      getProviders.mockReturnValue([first, second]);

      await renderHome();
      await userEvent.click(screen.getByRole('tab', { name: 'Second' }));

      await waitFor(() => expect(second.getLibrary).toHaveBeenCalled());
      expect(storage.getSelectedSourceKey()).toBe('b');
    });

    it('opens on the source you used last', async () => {
      storage.setSelectedSourceKey('b');
      const first = makeProvider({ id: 'extension:a', name: 'First', sourceKey: 'a' });
      const second = makeProvider({ id: 'extension:b', name: 'Second', sourceKey: 'b' });
      getProviders.mockReturnValue([first, second]);

      await renderHome();

      await waitFor(() => expect(second.getLibrary).toHaveBeenCalled());
      expect(first.getLibrary).not.toHaveBeenCalled();
    });

    it('falls back to the first source when the remembered one is gone', async () => {
      storage.setSelectedSourceKey('uninstalled');
      const first = makeProvider({ id: 'extension:a', name: 'First', sourceKey: 'a' });
      getProviders.mockReturnValue([first]);

      await renderHome();

      await waitFor(() => expect(first.getLibrary).toHaveBeenCalled());
    });

    it('hides the tab row when only one source is installed', async () => {
      getProviders.mockReturnValue([makeProvider({ name: 'Only' })]);
      await renderHome();
      await screen.findByText('Bleach');

      expect(screen.queryByRole('button', { name: 'Only' })).not.toBeInTheDocument();
    });
  });
});

/**
 * There used to be two search boxes on screen - one in the top bar and one
 * on this page - which shared no value. Which one you typed into decided
 * whether the source filter beside it applied to your search.
 */
describe('narrowing a search to some sources', () => {
  const twoSources = () => {
    const first = makeProvider({
      id: 'extension:a', name: 'AniNeko', sourceKey: 'a',
      search: jest.fn().mockResolvedValue([
        { id: '/x', providerId: 'extension:a', title: 'From AniNeko' }
      ])
    });
    const second = makeProvider({
      id: 'extension:b', name: 'AnimePahe', sourceKey: 'b',
      search: jest.fn().mockResolvedValue([
        { id: '/y', providerId: 'extension:b', title: 'From AnimePahe' }
      ])
    });
    getProviders.mockReturnValue([first, second]);
    return { first, second };
  };

  beforeEach(() => { window.localStorage.clear(); getProviders.mockReset(); });

  it('has exactly one search box', async () => {
    twoSources();
    const { container } = await renderHome();
    expect(container.querySelectorAll('input[type="search"]')).toHaveLength(1);
  });

  it('asks every source when none is chosen', async () => {
    const { first, second } = twoSources();
    await renderHome('/?q=heart');

    await waitFor(() => expect(first.search).toHaveBeenCalled());
    expect(second.search).toHaveBeenCalled();
  });

  it('asks only the chosen source', async () => {
    const { first, second } = twoSources();
    storage.setSearchSourceKeys(['a']);

    await renderHome('/?q=heart');

    await waitFor(() => expect(first.search).toHaveBeenCalled());
    expect(second.search).not.toHaveBeenCalled();
  });

  it('asks both when both are chosen', async () => {
    const { first, second } = twoSources();
    storage.setSearchSourceKeys(['a', 'b']);

    await renderHome('/?q=heart');

    await waitFor(() => expect(first.search).toHaveBeenCalled());
    expect(second.search).toHaveBeenCalled();
  });

  // A selection naming only sources that have since been uninstalled would
  // otherwise search nothing, which reads as a broken search rather than as
  // a stale setting.
  it('falls back to every source when the chosen ones are gone', async () => {
    const { first, second } = twoSources();
    storage.setSearchSourceKeys(['uninstalled-source']);

    await renderHome('/?q=heart');

    await waitFor(() => expect(first.search).toHaveBeenCalled());
    expect(second.search).toHaveBeenCalled();
  });

  // ?source= is where a result group's arrow leads, so it has to win.
  it('lets a pinned source override the filter', async () => {
    const { first, second } = twoSources();
    storage.setSearchSourceKeys(['a']);

    await renderHome('/?q=heart&source=extension:b');

    await waitFor(() => expect(second.search).toHaveBeenCalled());
    expect(first.search).not.toHaveBeenCalled();
  });

  it('remembers the choice across a visit', async () => {
    twoSources();
    await renderHome();

    await userEvent.click(screen.getByRole('button', { name: /All sources/i }));
    await userEvent.click(screen.getByLabelText('AnimePahe'));

    expect(storage.getSearchSourceKeys()).toEqual(['b']);
  });
});


/**
 * The filters live behind a button on Home, and only on Home: filtering by
 * season means nothing on Library or History, and a control that does
 * nothing on the screen you are looking at is worse than no control.
 */
describe('the filter panel', () => {
  it('offers a filter button beside the sources', async () => {
    getProviders.mockReturnValue([makeProvider()]);
    await renderHome();

    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument();
  });

  // The bar it replaces used to sit on the page whether or not it was used.
  it('shows no season browser until a season is applied', async () => {
    getProviders.mockReturnValue([makeProvider()]);
    await renderHome();

    expect(screen.queryByText(/Discover by season/)).not.toBeInTheDocument();
  });

  it('shows the chosen season after applying', async () => {
    getProviders.mockReturnValue([makeProvider()]);
    await renderHome();

    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
    await userEvent.click(screen.getByRole('radio', { name: /Winter/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(await screen.findByRole('heading', { name: /Winter \d{4}/ })).toBeInTheDocument();
  });

  // Searching replaces the page; a season filter over search results would
  // be filtering something that is not there.
  it('hides the filter button while showing search results', async () => {
    getProviders.mockReturnValue([makeProvider()]);
    await renderHome('/?q=bleach');

    expect(screen.queryByRole('button', { name: 'Filters' })).not.toBeInTheDocument();
  });
});
