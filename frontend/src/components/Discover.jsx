import React, { useEffect, useState } from 'react';
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
 * Driven by the filter panel rather than by a toggle of its own. It used to
 * be a collapsed bar between the search box and the catalogue, costing a row
 * of a phone screen whether or not anyone opened it; now it renders nothing
 * at all until a season is chosen, and still fetches nothing until then.
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

export default function Discover({ season = '', year = new Date().getFullYear() }) {
  const [state, setState] = useState({ status: 'idle', results: [] });

  /**
   * Fetched when the applied filter changes, not on a click.
   *
   * The choice is made in the panel and this screen shows the answer, so
   * there is no button here to press - and no request at all while no
   * season is chosen.
   */
  useEffect(() => {
    if (!season) {
      setState({ status: 'idle', results: [] });
      return undefined;
    }

    let cancelled = false;
    setState({ status: 'loading', results: [] });

    getSeason({ season, year }).then(({ results, error }) => {
      if (cancelled) return;

      setState(error
        ? { status: 'error', results: [], error }
        : { status: 'ready', results });
    });

    return () => { cancelled = true; };
  }, [season, year]);

  if (!season) return null;

  const label = (SEASONS.find((option) => option.value === season) || {}).label || season;

  return (
    <section className="discover">
      <h2 className="discover-heading">
        {label.replace(/\s*\(.*\)$/, '')} {year}
      </h2>

      <div className="discover-body">
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
    </section>
  );
}
