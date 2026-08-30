/**
 * Navigation must be reachable at every width.
 *
 * The bug this replaces was invisible on a desktop: a media query hid the
 * Settings link below 768px, next to a menu button that had been deleted, so
 * on a phone the screen that decides what the app can show could only be
 * reached by typing its URL. These tests pin the destinations and the active
 * state; the widths are covered by the bar being fixed rather than
 * conditional, which is why there is no media query left to test.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BottomNav from '../BottomNav';
import Navbar from '../Navbar';

const renderAt = (path) =>
  render(<MemoryRouter initialEntries={[path]}><BottomNav /></MemoryRouter>);

describe('BottomNav', () => {
  it('offers Home and Settings', () => {
    renderAt('/');
    expect(screen.getByRole('link', { name: /Home/ })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: /Settings/ })).toHaveAttribute('href', '/settings');
  });

  it('marks the current destination', () => {
    renderAt('/settings');
    expect(screen.getByRole('link', { name: /Settings/ })).toHaveClass('active');
    expect(screen.getByRole('link', { name: /Home/ })).not.toHaveClass('active');
  });

  it('does not mark Home active on every route, which "/" would otherwise match', () => {
    renderAt('/anime?source=a&id=b');
    expect(screen.getByRole('link', { name: /Home/ })).not.toHaveClass('active');
  });

  it('is rendered unconditionally, not behind a menu that must be opened', () => {
    const { container } = renderAt('/');
    expect(container.querySelector('.bottom-nav')).toBeInTheDocument();
    expect(container.querySelectorAll('.bottom-nav-item')).toHaveLength(2);
  });
});

describe('Navbar', () => {
  it('no longer carries the navigation that a media query hid', () => {
    const { container } = render(<MemoryRouter><Navbar /></MemoryRouter>);
    expect(container.querySelector('.nav-menu')).not.toBeInTheDocument();
  });

  it('keeps the way home', () => {
    render(<MemoryRouter><Navbar /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /Animiru/ })).toHaveAttribute('href', '/');
  });

  // There used to be a search box here as well as the one on the page
  // below, so two were on screen at once. They shared no value, so which one
  // you typed into decided whether the source filter beside it applied.
  it('no longer carries a second search box', () => {
    const { container } = render(<MemoryRouter><Navbar /></MemoryRouter>);
    expect(container.querySelector('input[type="search"], .search-input')).toBeNull();
    expect(screen.queryByPlaceholderText(/Search anime/i)).not.toBeInTheDocument();
  });
});
