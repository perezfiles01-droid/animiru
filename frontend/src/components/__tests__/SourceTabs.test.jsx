/**
 * Choosing which source the page is showing.
 *
 * Eight installed sources wrapped onto four lines and pushed the search box
 * and the catalogue off the top of a phone screen. The row is the thing
 * being chosen from, not the page, so it scrolls.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import SourceTabs from '../SourceTabs';

const SOURCES = [
  'AnimeParadise', 'AniWave', 'Anidap', 'AniKoto',
  'AniLight', 'AnimeHeaven', 'AnimePahe', 'AniNeko'
].map((name, index) => ({ id: `extension:${index}`, name }));

const show = (props = {}) => render(
  <SourceTabs providers={SOURCES} selectedId="extension:0" onSelect={() => {}} {...props} />
);

describe('SourceTabs', () => {
  it('lists every installed source', () => {
    show();
    expect(screen.getAllByRole('tab')).toHaveLength(8);
  });

  it('marks the one being shown', () => {
    show({ selectedId: 'extension:3' });

    expect(screen.getByRole('tab', { name: 'AniKoto' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'AniWave' })).toHaveAttribute('aria-selected', 'false');
  });

  it('reports the source that was tapped', async () => {
    const onSelect = jest.fn();
    show({ onSelect });

    await userEvent.click(screen.getByRole('tab', { name: 'AnimePahe' }));
    expect(onSelect).toHaveBeenCalledWith(SOURCES[6]);
  });

  // A row with one tab is a control that does nothing.
  it('renders nothing for a single source', () => {
    const { container } = render(
      <SourceTabs providers={[SOURCES[0]]} selectedId="extension:0" onSelect={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when no source is installed', () => {
    const { container } = render(<SourceTabs providers={[]} onSelect={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  /**
   * The row scrolls, so the selected tab can be off the end of it. Opening
   * the app with the eighth source remembered would start the strip at the
   * first and look as though nothing were selected.
   */
  it('scrolls the chosen source into view', () => {
    const scrollIntoView = jest.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;

    show({ selectedId: 'extension:7' });

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'center' });
  });

  it('follows the selection when it changes', () => {
    const scrollIntoView = jest.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;

    const { rerender } = show({ selectedId: 'extension:0' });
    scrollIntoView.mockClear();

    rerender(
      <SourceTabs providers={SOURCES} selectedId="extension:5" onSelect={() => {}} />
    );

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  // jsdom has scrollIntoView, a WebView may not implement the options form.
  it('survives a browser without scrollIntoView', () => {
    window.HTMLElement.prototype.scrollIntoView = undefined;
    expect(() => show()).not.toThrow();
  });
});
