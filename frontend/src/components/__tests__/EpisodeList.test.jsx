/**
 * A show with 360 episodes rendered every one of them into a single grid.
 * Twenty at a time, with a search for the rest.
 */

import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import EpisodeList, { PER_PAGE } from '../EpisodeList';

const many = (count) => Array.from({ length: count }, (unused, index) => ({
  id: `/e/${index + 1}`,
  title: `Episode ${index + 1}`,
  number: index + 1
}));

function show(episodes, { currentId, onOpen = jest.fn() } = {}) {
  render(
    <EpisodeList
      episodes={episodes}
      currentId={currentId}
      onOpen={onOpen}
      renderEpisode={(episode, { className, onSelect }) => (
        <button key={episode.id} type="button" className={className} onClick={onSelect}>
          {episode.title}
        </button>
      )}
    />
  );
  return onOpen;
}

describe('paging through episodes', () => {
  it('shows twenty at a time', () => {
    show(many(360));

    expect(screen.getByText('Episode 20')).toBeInTheDocument();
    expect(screen.queryByText('Episode 21')).not.toBeInTheDocument();
    expect(PER_PAGE).toBe(20);
  });

  it('says which page of how many', () => {
    show(many(360));
    expect(screen.getByText('Page 1 of 18')).toBeInTheDocument();
  });

  it('steps forward and back', async () => {
    show(many(360));

    await userEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.getByText('Episode 21')).toBeInTheDocument();
    expect(screen.queryByText('Episode 20')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Prev/ }));
    expect(screen.getByText('Episode 20')).toBeInTheDocument();
  });

  it('cannot step past either end', async () => {
    show(many(30));

    expect(screen.getByRole('button', { name: /Prev/ })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
  });

  // Episode 200 is nine taps away otherwise.
  it('opens on the page holding what is being watched', () => {
    show(many(360), { currentId: '/e/205' });

    expect(screen.getByText('Episode 205')).toBeInTheDocument();
    expect(screen.getByText('Page 11 of 18')).toBeInTheDocument();
  });

  it('offers no pager when everything fits on one page', () => {
    show(many(12));
    expect(screen.queryByText(/Page 1 of/)).not.toBeInTheDocument();
  });
});

describe('searching for an episode', () => {
  it('suggests every episode whose number contains what was typed', async () => {
    show(many(120));

    await userEvent.type(screen.getByLabelText('Search episodes'), '1');
    const list = screen.getByRole('list', { name: 'Matching episodes' });

    for (const label of ['Episode 1', 'Episode 11', 'Episode 12', 'Episode 21', 'Episode 100']) {
      expect(within(list).getByText(label)).toBeInTheDocument();
    }
  });

  // Searching a paginated list that only looked at the visible page would
  // be a worse kind of useless than no search at all.
  it('searches every episode, not just the page on screen', async () => {
    show(many(360));

    await userEvent.type(screen.getByLabelText('Search episodes'), '350');
    expect(screen.getByRole('list', { name: 'Matching episodes' }))
      .toHaveTextContent('Episode 350');
  });

  // A keystroke must not start loading an episode that was only ever a
  // prefix of the one being looked for.
  it('opens nothing while typing', async () => {
    const onOpen = show(many(60));

    await userEvent.type(screen.getByLabelText('Search episodes'), '12');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('opens only what is chosen from the suggestions', async () => {
    const onOpen = show(many(60));

    await userEvent.type(screen.getByLabelText('Search episodes'), '12');
    const list = screen.getByRole('list', { name: 'Matching episodes' });
    await userEvent.click(within(list).getByText('Episode 12'));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0]).toMatchObject({ title: 'Episode 12' });
  });

  it('moves the list to the chosen episode once it is picked', async () => {
    show(many(360));

    await userEvent.type(screen.getByLabelText('Search episodes'), '205');
    const list = screen.getByRole('list', { name: 'Matching episodes' });
    await userEvent.click(within(list).getByText('Episode 205'));

    expect(screen.getByText('Page 11 of 18')).toBeInTheDocument();
  });

  it('says so when nothing matches', async () => {
    show(many(20));

    await userEvent.type(screen.getByLabelText('Search episodes'), 'zzz');
    expect(screen.getByText(/No episode matches that/)).toBeInTheDocument();
  });

  it('goes back to the list when the search is cleared', async () => {
    show(many(60));

    const box = screen.getByLabelText('Search episodes');
    await userEvent.type(box, '12');
    fireEvent.change(box, { target: { value: '' } });

    expect(screen.queryByRole('list', { name: 'Matching episodes' })).not.toBeInTheDocument();
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
  });

  it('matches on the episode title as well as the number', async () => {
    show([
      { id: '/a', title: 'Episode 1: The First Villager', number: 1 },
      { id: '/b', title: 'Episode 2: Waterways', number: 2 }
    ]);

    await userEvent.type(screen.getByLabelText('Search episodes'), 'water');
    expect(screen.getByRole('list', { name: 'Matching episodes' }))
      .toHaveTextContent('Waterways');
  });
});
