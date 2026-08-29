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
    expect(link).toHaveAttribute(
      'href',
      '/anime?source=extension%3Arepo%231&id=%2Fa%2F1'
    );
  });

  it('searches the source when a query is in the URL', async () => {
    const provider = makeProvider();
    getProviders.mockReturnValue([provider]);

    await renderHome('/?q=bleach');

    await waitFor(() => expect(provider.search).toHaveBeenCalledWith('bleach', 1));
    expect(provider.getLibrary).not.toHaveBeenCalled();
    expect(screen.getByText('Results for "bleach"')).toBeInTheDocument();
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
      await userEvent.click(screen.getByRole('button', { name: 'Second' }));

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
