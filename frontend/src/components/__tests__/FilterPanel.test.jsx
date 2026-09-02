/**
 * The filters, behind a button.
 *
 * "Discover by season" used to be a bar between the search box and the
 * catalogue, taking a row of a phone screen from everyone whether or not
 * they ever opened it.
 */

import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import FilterPanel from '../FilterPanel';

/** Drives the panel as Home does, so applying is observable. */
function Harness({ onApply = () => {}, initial = { season: '', year: 2026 } }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState(initial);

  return (
    <FilterPanel
      open={open}
      season={filter.season}
      year={filter.year}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      onApply={(next) => { setFilter(next); onApply(next); }}
    />
  );
}

const show = (props) => render(<Harness {...props} />);
const openPanel = () => userEvent.click(screen.getByRole('button', { name: 'Filters' }));

describe('the filter button', () => {
  it('opens the panel', async () => {
    show();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await openPanel();
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument();
  });

  // A page showing one season looks like a page that has lost its
  // catalogue, unless something says a filter is in force.
  it('marks itself when a filter is applied', async () => {
    show({ initial: { season: 'FALL', year: 2026 } });
    expect(screen.getByRole('button', { name: 'Filters' })).toHaveClass('filter-button--on');
  });

  it('is unmarked with no filter applied', () => {
    show();
    expect(screen.getByRole('button', { name: 'Filters' }))
      .not.toHaveClass('filter-button--on');
  });
});

describe('choosing a season', () => {
  it('offers every season as a radio', async () => {
    show();
    await openPanel();

    expect(screen.getAllByRole('radio')).toHaveLength(5);
    expect(screen.getByRole('radio', { name: /Winter \(January – March\)/ })).toBeInTheDocument();
  });

  it('starts on the season already applied', async () => {
    show({ initial: { season: 'SUMMER', year: 2026 } });
    await openPanel();

    expect(screen.getByRole('radio', { name: /Summer/ })).toBeChecked();
  });

  it('applies the choice and closes', async () => {
    const onApply = jest.fn();
    show({ onApply });
    await openPanel();

    await userEvent.click(screen.getByRole('radio', { name: /Fall/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onApply).toHaveBeenCalledWith({ season: 'FALL', year: 2026 });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('takes the year with it', async () => {
    const onApply = jest.fn();
    show({ onApply });
    await openPanel();

    await userEvent.click(screen.getByRole('radio', { name: /Spring/ }));
    await userEvent.selectOptions(screen.getByLabelText('Year'), '2019');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onApply).toHaveBeenCalledWith({ season: 'SPRING', year: 2019 });
  });

  it('clears everything on Reset', async () => {
    const onApply = jest.fn();
    show({ onApply, initial: { season: 'FALL', year: 2020 } });
    await openPanel();

    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));

    expect(onApply).toHaveBeenCalledWith({
      season: '', year: new Date().getFullYear()
    });
  });
});

describe('closing without applying', () => {
  it('changes nothing', async () => {
    const onApply = jest.fn();
    show({ onApply });
    await openPanel();

    await userEvent.click(screen.getByRole('radio', { name: /Winter/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Close filters' }));

    expect(onApply).not.toHaveBeenCalled();
  });

  /**
   * Reopening must show the filter in force, not the half-made choice that
   * was abandoned - otherwise the panel and the page disagree.
   */
  it('forgets the abandoned choice on reopening', async () => {
    show();
    await openPanel();

    await userEvent.click(screen.getByRole('radio', { name: /Winter/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Close filters' }));
    await openPanel();

    expect(screen.getByRole('radio', { name: /Any Season/ })).toBeChecked();
  });

  // What people try before looking for a close button.
  it('closes on a tap outside the panel', async () => {
    const { container } = show();
    await openPanel();

    await userEvent.click(container.querySelector('.filter-backdrop'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    show();
    await openPanel();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
