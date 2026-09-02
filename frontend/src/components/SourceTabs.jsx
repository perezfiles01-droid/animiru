import React, { useEffect, useRef } from 'react';
import '../styles/Extensions.css';

/**
 * Picks which installed source the page is showing.
 *
 * Sources are not merged into one list. Two scrapers share no ids, no
 * ranking and no idea of the same show, so a combined grid would be a pile
 * of near-duplicates the app could not deduplicate honestly. One source at a
 * time, chosen explicitly.
 *
 * Renders nothing when only one source is installed - a tab row with a
 * single tab is a control that does nothing.
 */
export default function SourceTabs({ providers, selectedId, onSelect }) {
  const selectedRef = useRef(null);

  /**
   * Keeps the chosen source in view.
   *
   * The row scrolls now, so the selected tab can be off the end of it -
   * on opening the app with the eighth source remembered, the strip would
   * start at the first and look as though nothing were selected.
   */
  useEffect(() => {
    const tab = selectedRef.current;
    if (!tab || typeof tab.scrollIntoView !== 'function') return;

    tab.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [selectedId]);

  if (!providers || providers.length < 2) return null;

  return (
    <div className="ext-source-tabs" role="tablist" aria-label="Sources">
      {providers.map((provider) => {
        const active = provider.id === selectedId;

        return (
          <button
            key={provider.id}
            ref={active ? selectedRef : null}
            type="button"
            role="tab"
            aria-selected={active}
            className={`ext-source-tab ${active ? 'active' : ''}`}
            onClick={() => onSelect(provider)}
          >
            {provider.name}
          </button>
        );
      })}
    </div>
  );
}
