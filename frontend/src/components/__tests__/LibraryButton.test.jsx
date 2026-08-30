import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import LibraryButton from '../LibraryButton';
import { getLibrary, addToLibrary } from '../../services/library';

const item = {
  id: '/anime/frieren',
  providerId: 'extension:a',
  providerName: 'AniNeko',
  title: 'Frieren',
  poster: 'https://i.test/f.jpg'
};

describe('the Add to library button', () => {
  beforeEach(() => window.localStorage.clear());

  it('offers to add a title that is not saved', () => {
    render(<LibraryButton item={item} />);

    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('Add to library');
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('turns into In library when clicked, and saves it', () => {
    render(<LibraryButton item={item} />);
    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByRole('button')).toHaveTextContent('In library');
    expect(getLibrary()).toHaveLength(1);
  });

  // The label says what the button is, not what clicking does: "Add to
  // library" on a saved title would be a lie, and "Remove" would leave no
  // way to see the current state.
  it('opens as In library for a title already saved', () => {
    addToLibrary(item);
    render(<LibraryButton item={item} />);

    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('In library');
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('takes it back out when clicked again', () => {
    render(<LibraryButton item={item} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByRole('button')).toHaveTextContent('Add to library');
    expect(getLibrary()).toEqual([]);
  });
});
