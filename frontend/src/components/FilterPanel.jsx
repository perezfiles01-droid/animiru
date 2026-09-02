import React, { useEffect, useRef } from 'react';
import { SEASONS, years } from './Discover';
import '../styles/Discover.css';

/**
 * The filters, behind a button rather than on the page.
 *
 * "Discover by season" used to be a bar sitting between the search box and
 * the catalogue, taking a row of the screen from everyone whether or not
 * they ever opened it. It is a filter, so it belongs where filters go.
 *
 * A drawer rather than a dropdown: season, year and two buttons do not fit
 * under a control on a phone without either clipping or covering what they
 * are filtering.
 */
export default function FilterPanel({ open, season, year, onOpen, onClose, onApply }) {
  const [draftSeason, setDraftSeason] = React.useState(season);
  const [draftYear, setDraftYear] = React.useState(year);
  const panelRef = useRef(null);

  /**
   * The draft follows what is actually applied whenever the panel opens.
   *
   * Without this, closing it without applying would leave the half-made
   * choice sitting there, and reopening would show a filter that is not the
   * one in force.
   */
  useEffect(() => {
    if (!open) return;
    setDraftSeason(season);
    setDraftYear(year);
  }, [open, season, year]);

  /** Escape closes it, as it does every other layer over a page. */
  useEffect(() => {
    if (!open) return undefined;

    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const apply = () => {
    onApply({ season: draftSeason, year: draftYear });
    onClose();
  };

  const reset = () => {
    setDraftSeason('');
    setDraftYear(new Date().getFullYear());
    onApply({ season: '', year: new Date().getFullYear() });
    onClose();
  };

  return (
    <>
      <button
        type="button"
        className={`filter-button ${season ? 'filter-button--on' : ''}`}
        aria-label="Filters"
        aria-expanded={open}
        onClick={onOpen}
      >
        <span aria-hidden="true">☰</span>
      </button>

      {open && (
        <>
          {/* A tap anywhere off the panel closes it, which is what people
              try before looking for a close button. */}
          <div className="filter-backdrop" onClick={onClose} aria-hidden="true" />

          <aside
            className="filter-panel"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Filters"
          >
            <header className="filter-panel-header">
              <h2>Filters</h2>
              <button
                type="button"
                className="filter-close"
                aria-label="Close filters"
                onClick={onClose}
              >
                ✕
              </button>
            </header>

            <fieldset className="filter-group">
              <legend>Season</legend>
              {SEASONS.map((option) => (
                <label key={option.value || 'any'} className="filter-radio">
                  <input
                    type="radio"
                    name="season"
                    value={option.value}
                    checked={draftSeason === option.value}
                    onChange={() => setDraftSeason(option.value)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </fieldset>

            {/* Year stays a select. Sixty radio buttons is a list to scroll,
                not a choice to read. */}
            <label className="filter-field">
              <span>Year</span>
              <select
                value={draftYear}
                onChange={(event) => setDraftYear(Number(event.target.value))}
              >
                {years().map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>

            <div className="filter-actions">
              <button type="button" className="btn btn-primary" onClick={apply}>
                Apply
              </button>
              <button type="button" className="btn btn-secondary" onClick={reset}>
                Reset
              </button>
            </div>
          </aside>
        </>
      )}
    </>
  );
}
