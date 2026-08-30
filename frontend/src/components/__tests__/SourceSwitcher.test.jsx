/**
 * Sources break - a site moves domain, adds a bot check, changes its
 * markup - and when that happens mid-show the useful thing is to carry on
 * somewhere else rather than start the search again from Home.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import '@testing-library/jest-dom';
import SourceSwitcher from '../SourceSwitcher';
import { getProviders } from '../../services/providers/registry';

jest.mock('../../services/providers/registry', () => ({ getProviders: jest.fn() }));

const PROVIDERS = [
  { id: 'extension:a', name: 'AniNeko' },
  { id: 'extension:b', name: 'AnimePahe' },
  { id: 'extension:c', name: 'Miruro' }
];

/** Renders with a landing route, so the navigation can be asserted. */
function show(props = {}) {
  render(
    <MemoryRouter initialEntries={['/watch']}>
      <Routes>
        <Route
          path="/watch"
          element={<SourceSwitcher currentId="extension:a" title="Farming Life" {...props} />}
        />
        <Route path="/" element={<div>landed</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('switching a show to another extension', () => {
  beforeEach(() => getProviders.mockReturnValue(PROVIDERS));

  it('names the source being used', () => {
    show();
    expect(screen.getByRole('button')).toHaveTextContent('AniNeko');
  });

  it('offers the other extensions, not the one already in use', async () => {
    show();
    await userEvent.click(screen.getByRole('button', { name: /AniNeko/ }));

    // Scoped to the menu: the toggle still reads "AniNeko", so asking the
    // whole screen would match the control that opened it.
    const menu = screen.getByRole('group', { name: /another extension/i });

    expect(within(menu).getByRole('button', { name: 'AnimePahe' })).toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: 'Miruro' })).toBeInTheDocument();
    expect(within(menu).queryByRole('button', { name: 'AniNeko' })).toBeNull();
  });

  // Sources disagree about numbering - recaps and specials shift the count -
  // so opening "the same episode" elsewhere would sometimes be the wrong one.
  it('warns that numbering differs between sources', async () => {
    show();
    await userEvent.click(screen.getByRole('button', { name: /AniNeko/ }));

    expect(screen.getByText(/numbering can differ/i)).toBeInTheDocument();
  });

  it('looks the show up on the extension that was chosen', async () => {
    delete window.location;
    show();

    await userEvent.click(screen.getByRole('button', { name: /AniNeko/ }));
    await userEvent.click(screen.getByRole('button', { name: 'AnimePahe' }));

    expect(screen.getByText('landed')).toBeInTheDocument();
  });

  // Nothing to switch to.
  it('renders nothing when only one extension is installed', () => {
    getProviders.mockReturnValue([PROVIDERS[0]]);
    const { container } = render(
      <MemoryRouter><SourceSwitcher currentId="extension:a" title="X" /></MemoryRouter>
    );

    expect(container).toBeEmptyDOMElement();
  });
});
