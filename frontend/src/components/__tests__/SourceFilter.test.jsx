import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import SourceFilter from '../SourceFilter';

const PROVIDERS = [
  { id: 'extension:a', name: 'AniNeko' },
  { id: 'extension:b', name: 'AnimePahe' },
  { id: 'extension:c', name: 'Re:ANIME' }
];

/** Controlled by the page in real use, so the test drives it the same way. */
function Harness({ initial = [], onChange = () => {} }) {
  const [selected, setSelected] = useState(initial);
  return (
    <SourceFilter
      providers={PROVIDERS}
      selected={selected}
      onChange={(next) => { setSelected(next); onChange(next); }}
    />
  );
}

const open = () => fireEvent.click(screen.getByRole('button', { expanded: false }));

describe('choosing which sources a search asks', () => {
  it('says all sources when nothing is chosen', () => {
    render(<Harness />);
    expect(screen.getByRole('button')).toHaveTextContent('All sources');
  });

  it('lists every installed source', () => {
    render(<Harness />);
    open();
    for (const provider of PROVIDERS) {
      expect(screen.getByLabelText(provider.name)).toBeInTheDocument();
    }
  });

  it('selects more than one', () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);
    open();

    fireEvent.click(screen.getByLabelText('AniNeko'));
    fireEvent.click(screen.getByLabelText('AnimePahe'));

    expect(onChange).toHaveBeenLastCalledWith(['extension:a', 'extension:b']);
    expect(screen.getByRole('button', { expanded: true })).toHaveTextContent('2 sources');
  });

  it('names the source when only one is chosen', () => {
    render(<Harness initial={['extension:c']} />);
    expect(screen.getByRole('button')).toHaveTextContent('Re:ANIME');
  });

  it('unticks a source that was ticked', () => {
    const onChange = jest.fn();
    render(<Harness initial={['extension:a', 'extension:b']} onChange={onChange} />);
    open();

    fireEvent.click(screen.getByLabelText('AniNeko'));
    expect(onChange).toHaveBeenLastCalledWith(['extension:b']);
  });

  it('goes back to all sources in one action', () => {
    const onChange = jest.fn();
    render(<Harness initial={['extension:a']} onChange={onChange} />);
    open();

    fireEvent.click(screen.getByRole('button', { name: /Search all sources/i }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  // Nothing to clear, so offering to clear it is a button that does nothing.
  it('offers nothing to clear when nothing is chosen', () => {
    render(<Harness />);
    open();
    expect(screen.getByRole('button', { name: /Search all sources/i })).toBeDisabled();
  });

  // A dropdown left open sits over the results it is filtering.
  it('closes when the page outside it is clicked', () => {
    render(<div><Harness /><button type="button">elsewhere</button></div>);
    open();
    expect(screen.getByRole('group')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });
});
