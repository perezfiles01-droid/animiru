/**
 * The library draws from what was stored when each title was saved, so it
 * has to work with every source uninstalled - that is what separates a
 * library from a list of links into sources.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import Library from '../Library';
import { addToLibrary, getLibrary } from '../../services/library';

const show = (overrides = {}) => ({
  id: '/anime/frieren',
  providerId: 'extension:a',
  providerName: 'AniNeko',
  title: 'Frieren',
  poster: 'https://i.test/f.jpg',
  ...overrides
});

const renderLibrary = () =>
  render(<MemoryRouter><Library /></MemoryRouter>);

describe('the Library screen', () => {
  beforeEach(() => window.localStorage.clear());

  it('says how to fill it when it is empty', () => {
    renderLibrary();

    expect(screen.getByText(/Nothing saved yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Add to library/i)).toBeInTheDocument();
  });

  it('lists what has been saved', () => {
    addToLibrary(show());
    addToLibrary(show({ id: '/anime/dandadan', title: 'Dandadan' }));

    renderLibrary();

    expect(screen.getByText('Frieren')).toBeInTheDocument();
    expect(screen.getByText('Dandadan')).toBeInTheDocument();
    expect(screen.getByText('2 titles')).toBeInTheDocument();
  });

  it('counts one title in the singular', () => {
    addToLibrary(show());
    renderLibrary();
    expect(screen.getByText('1 title')).toBeInTheDocument();
  });

  it('links each title back to its source detail page', () => {
    addToLibrary(show());
    renderLibrary();

    expect(screen.getByRole('link', { name: /Frieren/ })).toHaveAttribute(
      'href',
      '/anime?source=extension%3Aa&id=%2Fanime%2Ffrieren'
    );
  });

  it('removes a title, and the shelf updates without a reload', () => {
    addToLibrary(show());
    renderLibrary();

    fireEvent.click(screen.getByRole('button', { name: /Remove Frieren/i }));

    expect(screen.queryByText('Frieren')).not.toBeInTheDocument();
    expect(getLibrary()).toEqual([]);
    expect(screen.getByText(/Nothing saved yet/i)).toBeInTheDocument();
  });

  // The whole point of storing the poster and title rather than a reference.
  it('draws without asking any source', () => {
    addToLibrary(show());
    renderLibrary();

    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://i.test/f.jpg');
  });

  it('copes with a title saved without a poster', () => {
    addToLibrary(show({ poster: '' }));
    renderLibrary();

    expect(screen.getByText('Frieren')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});


/**
 * A library that has grown past a screenful needs a way to reach one title.
 */
describe('searching the library', () => {
  const saved = () => {
    addToLibrary({ id: '/a', providerId: 'extension:1', title: 'Tokyo Ghoul' });
    addToLibrary({ id: '/b', providerId: 'extension:1', title: 'Bleach' });
  };

  beforeEach(() => window.localStorage.clear());

  it('narrows to what is typed', async () => {
    saved();
    render(<MemoryRouter><Library /></MemoryRouter>);

    await userEvent.type(screen.getByRole('searchbox', { name: /Search library/ }), 'ghoul');

    expect(screen.getByText('Tokyo Ghoul')).toBeInTheDocument();
    expect(screen.queryByText('Bleach')).not.toBeInTheDocument();
  });

  it('does not care about case', async () => {
    saved();
    render(<MemoryRouter><Library /></MemoryRouter>);

    await userEvent.type(screen.getByRole('searchbox', { name: /Search library/ }), 'BLEACH');
    expect(screen.getByText('Bleach')).toBeInTheDocument();
  });

  // A filtered-to-nothing grid is indistinguishable from an empty library.
  it('says when nothing matches, and keeps the search box', async () => {
    saved();
    render(<MemoryRouter><Library /></MemoryRouter>);

    await userEvent.type(screen.getByRole('searchbox', { name: /Search library/ }), 'naruto');

    expect(screen.getByText(/Nothing saved matches/)).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: /Search library/ })).toBeInTheDocument();
    expect(screen.queryByText(/Nothing saved yet/)).not.toBeInTheDocument();
  });

  it('still counts the whole library, not the filtered part', async () => {
    saved();
    render(<MemoryRouter><Library /></MemoryRouter>);

    await userEvent.type(screen.getByRole('searchbox', { name: /Search library/ }), 'ghoul');
    expect(screen.getByText('2 titles')).toBeInTheDocument();
  });
});
