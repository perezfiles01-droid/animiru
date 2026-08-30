/**
 * What you have watched, and getting back into it.
 *
 * The only reason to open a history is to resume something, so the rows are
 * links to the exact episode at the exact position - not to the title.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import History, { dayLabel, groupByDay } from '../History';
import { recordProgress, getHistory } from '../../services/history';

const DAY = 86400000;

const watched = (overrides = {}) => recordProgress({
  providerId: 'extension:repo#1',
  providerName: 'AniNeko',
  itemId: '/anime/tokyo-ghoul',
  title: 'Tokyo Ghoul',
  poster: 'https://i.test/tg.jpg',
  episodeId: '/e/1',
  episodeTitle: 'Episode 1',
  episodeNumber: 1,
  position: 117,
  duration: 1440,
  ...overrides
});

const show = () => render(<MemoryRouter><History /></MemoryRouter>);

beforeEach(() => window.localStorage.clear());

describe('grouping by day', () => {
  const now = new Date('2026-08-30T20:00:00').getTime();

  it.each([
    ['Today', 0],
    ['Yesterday', 1]
  ])('calls %s what it is', (label, daysAgo) => {
    expect(dayLabel(now - daysAgo * DAY, now)).toBe(label);
  });

  it('names the date for anything older', () => {
    expect(dayLabel(now - 5 * DAY, now)).toMatch(/2026/);
  });

  /**
   * Two hours apart but either side of midnight. Counting elapsed hours
   * calls that "Today"; a person calls it last night.
   */
  it('compares calendar days, not elapsed hours', () => {
    const lateLastNight = new Date('2026-08-29T23:00:00').getTime();
    const justAfterMidnight = new Date('2026-08-30T01:00:00').getTime();

    expect(dayLabel(lateLastNight, justAfterMidnight)).toBe('Yesterday');
  });

  it('still calls this morning today, late in the evening', () => {
    const earlyToday = new Date('2026-08-30T00:30:00').getTime();
    expect(dayLabel(earlyToday, now)).toBe('Today');
  });

  it('keeps the order it was given', () => {
    const groups = groupByDay([
      { title: 'a', watchedAt: now },
      { title: 'b', watchedAt: now - DAY },
      { title: 'c', watchedAt: now }
    ], now);

    expect(groups.map((group) => group.label)).toEqual(['Today', 'Yesterday']);
    expect(groups[0].entries).toHaveLength(2);
  });
});

describe('the history screen', () => {
  it('says so plainly when nothing has been watched', () => {
    show();
    expect(screen.getByText(/Nothing watched yet/)).toBeInTheDocument();
  });

  it('shows the title, the episode and where it got to', () => {
    watched();
    show();

    expect(screen.getByText('Tokyo Ghoul')).toBeInTheDocument();
    expect(screen.getByText(/Episode 1 — 1:57/)).toBeInTheDocument();
  });

  it('groups the rows under the day they were watched', () => {
    watched();
    watched({ itemId: '/anime/bleach', title: 'Bleach', watchedAt: Date.now() - DAY });
    show();

    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Yesterday')).toBeInTheDocument();
  });

  // The whole point of the screen.
  it('links a row back to that episode at that position', () => {
    watched();
    show();

    const link = screen.getByRole('link', { name: /Tokyo Ghoul/ });
    expect(link).toHaveAttribute('href', expect.stringContaining('ep=%2Fe%2F1'));
    expect(link).toHaveAttribute('href', expect.stringContaining('&t=117'));
    expect(link).toHaveAttribute('href', expect.stringContaining('title=Tokyo%20Ghoul'));
  });

  // A finished episode resumes at its start, not in its credits - and the
  // link says so rather than leaving the player to infer it.
  it('links a finished episode at its beginning', () => {
    watched({ position: 1430 });
    show();

    expect(screen.getByRole('link', { name: /Tokyo Ghoul/ }))
      .toHaveAttribute('href', expect.stringContaining('&t=0'));
  });

  it('forgets one title without touching the others', async () => {
    watched();
    watched({ itemId: '/anime/bleach', title: 'Bleach' });
    show();

    await userEvent.click(screen.getByRole('button', { name: /Remove Tokyo Ghoul/ }));

    expect(screen.queryByText('Tokyo Ghoul')).not.toBeInTheDocument();
    expect(screen.getByText('Bleach')).toBeInTheDocument();
    expect(getHistory()).toHaveLength(1);
  });

  it('clears everything', async () => {
    watched();
    show();

    await userEvent.click(screen.getByRole('button', { name: /Clear all/ }));

    expect(screen.getByText(/Nothing watched yet/)).toBeInTheDocument();
    expect(getHistory()).toEqual([]);
  });
});

describe('searching the history', () => {
  it('narrows to what is typed', async () => {
    watched();
    watched({ itemId: '/anime/bleach', title: 'Bleach' });
    show();

    await userEvent.type(screen.getByRole('searchbox', { name: /Search history/ }), 'blea');

    expect(screen.getByText('Bleach')).toBeInTheDocument();
    expect(screen.queryByText('Tokyo Ghoul')).not.toBeInTheDocument();
  });

  it('does not care about case', async () => {
    watched();
    show();

    await userEvent.type(screen.getByRole('searchbox', { name: /Search history/ }), 'TOKYO');
    expect(screen.getByText('Tokyo Ghoul')).toBeInTheDocument();
  });

  it('says when nothing matches, rather than looking empty', async () => {
    watched();
    show();

    await userEvent.type(screen.getByRole('searchbox', { name: /Search history/ }), 'naruto');
    expect(screen.getByText(/Nothing watched matches/)).toBeInTheDocument();
  });

  // Filtering must not make the screen claim the history is empty.
  it('keeps the search box when a search matches nothing', async () => {
    watched();
    show();

    await userEvent.type(screen.getByRole('searchbox', { name: /Search history/ }), 'naruto');
    expect(screen.getByRole('searchbox', { name: /Search history/ })).toBeInTheDocument();
    expect(screen.queryByText(/Nothing watched yet/)).not.toBeInTheDocument();
  });

  it('regroups what is left', async () => {
    watched();
    watched({ itemId: '/anime/bleach', title: 'Bleach', watchedAt: Date.now() - DAY });
    show();

    await userEvent.type(screen.getByRole('searchbox', { name: /Search history/ }), 'bleach');

    expect(screen.queryByText('Today')).not.toBeInTheDocument();
    const yesterday = screen.getByText('Yesterday').closest('section');
    expect(within(yesterday).getByText('Bleach')).toBeInTheDocument();
  });
});
