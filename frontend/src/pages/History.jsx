import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getHistory, removeFromHistory, clearHistory, resumePosition, backfillPosters
} from '../services/history';
import { getProvider } from '../services/providers/registry';
import { formatPosition } from '../components/ContinueWatching';
import '../styles/Pages.css';

/**
 * What you have watched, newest first.
 *
 * Grouped by day rather than listed flat: "Today" and "Yesterday" are how
 * anyone thinks about what they were watching, and a bare timestamp on
 * every row is noise once the list is in order.
 *
 * A row goes back to the exact episode at the exact position, because that
 * is the only reason to open a history at all.
 */

/** The day an entry belongs to, as a label rather than a date. */
export function dayLabel(timestamp, now = Date.now()) {
  const startOf = (value) => {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  };

  const days = Math.round((startOf(now) - startOf(timestamp)) / 86400000);

  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';

  return new Date(timestamp).toLocaleDateString(undefined, {
    day: 'numeric', month: 'long', year: 'numeric'
  });
}

/** Groups in order, since a Map preserves insertion and the list is sorted. */
export function groupByDay(entries, now = Date.now()) {
  const groups = new Map();

  entries.forEach((entry) => {
    const label = dayLabel(entry.watchedAt, now);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(entry);
  });

  return [...groups.entries()].map(([label, rows]) => ({ label, entries: rows }));
}

export default function History() {
  const [entries, setEntries] = useState(() => getHistory());

  /**
   * Entries recorded before the player carried posters have none, and
   * nothing in the normal flow will ever give them one. Asked for once,
   * on open, and only for the rows that are missing it.
   */
  useEffect(() => {
    let cancelled = false;

    backfillPosters({ getProvider }).then((repaired) => {
      if (!cancelled) setEntries(repaired);
    });

    return () => { cancelled = true; };
  }, []);
  const [query, setQuery] = useState('');

  const matching = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    if (!wanted) return entries;

    return entries.filter((entry) => String(entry.title || '').toLowerCase().includes(wanted));
  }, [entries, query]);

  const groups = useMemo(() => groupByDay(matching), [matching]);

  const forget = (entry) => {
    removeFromHistory(entry);
    setEntries(getHistory());
  };

  const forgetAll = () => {
    clearHistory();
    setEntries(getHistory());
  };

  /**
   * Back to the episode, at the position.
   *
   * t is always sent, including a zero, so the player never has to guess:
   * an episode watched to the end resumes at its start rather than in its
   * credits, and this link says so rather than leaving it to be inferred.
   */
  const watchHref = (entry) =>
    `/watch?source=${encodeURIComponent(entry.providerId)}`
    + `&id=${encodeURIComponent(entry.itemId)}`
    + `&ep=${encodeURIComponent(entry.episodeId)}`
    + `&title=${encodeURIComponent(entry.title || '')}`
    // The poster travels too. Without it, resuming from this screen
    // re-records the entry with no image and the row stays blank for good -
    // the details page was the only thing that could ever fill it in.
    + (entry.poster ? `&poster=${encodeURIComponent(entry.poster)}` : '')
    + `&t=${Math.floor(resumePosition(entry, entry.episodeId))}`;

  if (entries.length === 0) {
    return (
      <div className="library-page">
        <h1>History</h1>
        <section className="empty-state">
          <h2>Nothing watched yet</h2>
          <p>
            Episodes you watch appear here, with where you got to. History is
            stored on this device.
          </p>
          <Link to="/" className="btn btn-primary">Browse</Link>
        </section>
      </div>
    );
  }

  return (
    <div className="library-page">
      <header className="history-header">
        <h1>History</h1>
        <button type="button" className="btn btn-link" onClick={forgetAll}>
          Clear all
        </button>
      </header>

      <label className="list-search">
        <span className="visually-hidden">Search history</span>
        <input
          type="search"
          value={query}
          placeholder="Search history"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {matching.length === 0 && (
        <p className="extensions-empty">Nothing watched matches “{query}”.</p>
      )}

      {groups.map((group) => (
        <section key={group.label} className="history-group">
          <h2 className="history-day">{group.label}</h2>

          {group.entries.map((entry) => (
            <div key={`${entry.providerId}:${entry.itemId}`} className="history-row">
              <Link to={watchHref(entry)} className="history-row-link">
                {entry.poster
                  ? <img src={entry.poster} alt="" className="history-poster" />
                  : <div className="history-poster history-poster--blank" aria-hidden="true" />}

                <span className="history-text">
                  <span className="history-title">{entry.title}</span>
                  <span className="history-episode">
                    {entry.episodeTitle || `Episode ${entry.episodeNumber ?? ''}`}
                    {' — '}
                    {formatPosition(entry.position)}
                  </span>
                </span>
              </Link>

              <button
                type="button"
                className="history-forget"
                onClick={() => forget(entry)}
                aria-label={`Remove ${entry.title} from history`}
              >
                🗑
              </button>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
