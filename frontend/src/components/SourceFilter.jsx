import React, { useEffect, useRef, useState } from 'react';
import '../styles/SourceFilter.css';

/**
 * Chooses which sources a search asks.
 *
 * Nothing ticked means every source, rather than none. A search names a
 * title, so the useful default is to ask everyone who might have it -
 * narrowing is the exception, and the exception is what the control is for.
 * Treating an empty selection as "search nothing" would also make the first
 * click on the filter break search, which is a trap rather than a control.
 */
export default function SourceFilter({ providers, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const container = useRef(null);

  // A dropdown that only closes via its own button is a dropdown that gets
  // left open over the results it is filtering.
  useEffect(() => {
    if (!open) return undefined;

    const dismiss = (event) => {
      if (container.current && !container.current.contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', dismiss);
    return () => document.removeEventListener('mousedown', dismiss);
  }, [open]);

  const toggle = (id) => {
    onChange(
      selected.includes(id)
        ? selected.filter((candidate) => candidate !== id)
        : [...selected, id]
    );
  };

  const label = selected.length === 0
    ? 'All sources'
    : selected.length === 1
      ? (providers.find((p) => p.id === selected[0]) || {}).name || '1 source'
      : `${selected.length} sources`;

  return (
    <div className="source-filter" ref={container}>
      <button
        type="button"
        className="source-filter-toggle"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((was) => !was)}
      >
        {label}
        <span aria-hidden="true" className="source-filter-caret">▾</span>
      </button>

      {open && (
        <div className="source-filter-menu" role="group" aria-label="Sources to search">
          <button
            type="button"
            className="source-filter-all"
            onClick={() => onChange([])}
            disabled={selected.length === 0}
          >
            Search all sources
          </button>

          {providers.map((provider) => (
            <label key={provider.id} className="source-filter-option">
              <input
                type="checkbox"
                checked={selected.includes(provider.id)}
                onChange={() => toggle(provider.id)}
              />
              <span>{provider.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
