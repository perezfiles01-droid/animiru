import React from 'react';
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
  if (!providers || providers.length < 2) return null;

  return (
    <div className="ext-source-tabs">
      {providers.map((provider) => (
        <button
          key={provider.id}
          type="button"
          className={`ext-source-tab ${provider.id === selectedId ? 'active' : ''}`}
          onClick={() => onSelect(provider)}
        >
          {provider.name}
        </button>
      ))}
    </div>
  );
}
