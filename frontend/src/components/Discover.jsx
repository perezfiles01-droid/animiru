import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { getSeason, findOnSourcesHref } from '../services/metadata';
import '../styles/Discover.css';

/**
 * What aired in a given season, from AniList.
 *
 * Not from your extensions, deliberately. A Mangayomi source has no notion
 * of a season, and the filter list some of them expose almost never covers
 * one - so answering this from the sources would mean implementing it
 * fifteen times over and getting nothing back from most of them. AniList
 * takes a season and a year as arguments and this is one request.
 *
 * Collapsed by default, and nothing is fetched until it is opened: Home
 * still opens straight onto the source's own catalogue, and this costs
 * nothing at all when it is not used.
 */

export const SEASONS = [
  { value: '', label: 'Any Season' },
  { value: 'WINTER', label: 'Winter (January – March)' },
  { value: 'SPRING', label: 'Spring (April – June)' },
  { value: 'SUMMER', label: 'Summer (July – September)' },
  { value: 'FALL', label: 'Fall / Autumn (October – December)' }
];

/** This year first, since that is what is usually wanted, back to 1960. */
export function years(now = new Date().getFullYear()) {
  const out = [];
  // One ahead: next season's line-up is announced before it airs.
  for (let year = now + 1; year >= 1960; year -= 1) out.push(year);
  return out;
}

export default function Discover() {
  const [open, setOpen] = useState(false);
  const [season, setSeason] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [state, setState] = useState({ status: 'idle', results: [] });

  const load = async () => {
    setState({ status: 'loading', results: [] });
    const { results, error } = await getSeason({ season, year });

    setState(error
      ? { status: 'error', results: [], error }
      : { status: 'ready', results });
  };

  return (
    <section className="discover">
      <button
        type="button"
        className="discover-toggle"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        Discover by season
        <span aria-hidden="true">{open ? ' ▲' : ' ▼'}</span>
      </button>

      {open && (
        <div className="discover-body">
          <div className="discover-filters">
            <label className="discover-field">
              <span>Season</span>
              <select value={season} onChange={(e) => setSeason(e.target.value)}>
                {SEASONS.map((option) => (
                  <option key={option.value || 'any'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="discover-field">
              <span>Year</span>
              <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
                {years().map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>

            <button type="button" className="btn btn-primary" onClick={load}>
              Show
            </button>
          </div>

          {state.status === 'loading' && <p className="loading">Loading...</p>}

          {/* This comes from AniList, not from a source, so a failure here
              says so rather than looking like a broken extension. */}
          {state.status === 'error' && (
            <p className="metadata-error">
              {state.error} This is AniList, not your sources - browsing and
              playback are unaffected.
            </p>
          )}

          {state.status === 'ready' && state.results.length === 0 && (
            <p className="extensions-empty">AniList lists nothing for that season.</p>
          )}

          {state.results.length > 0 && (
            <>
              <p className="discover-hint">
                Tap a title to look for it on your installed sources.
              </p>
              <div className="anime-grid">
                {state.results.map((entry) => (
                  <Link
                    key={entry.id}
                    to={findOnSourcesHref(entry.title)}
                    className="discover-card"
                  >
                    {entry.poster
                      ? <img src={entry.poster} alt="" className="discover-poster" />
                      : <div className="discover-poster discover-blank" aria-hidden="true" />}
                    <span className="discover-title">{entry.title}</span>
                    <span className="discover-meta">
                      {[entry.format, entry.year].filter(Boolean).join(' · ')}
                    </span>
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
