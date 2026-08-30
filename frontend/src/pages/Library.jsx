import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getLibrary, removeFromLibrary } from '../services/library';
import '../styles/Pages.css';

/**
 * The titles you have saved.
 *
 * Drawn entirely from what was stored at the moment of saving, so it opens
 * instantly and works with every source uninstalled - which is the point of
 * a library, as opposed to a list of links into sources.
 *
 * A saved title still links back to its source's detail page, since that is
 * where the episodes and the player are. If the source has since been
 * removed, the entry says so rather than leading somewhere that fails.
 */
export default function Library() {
  const [entries, setEntries] = useState(() => getLibrary());
  const [query, setQuery] = useState('');

  /**
   * Filtered here rather than by re-reading storage: the library is already
   * in memory, and a shelf that has to be re-read to be searched would
   * flicker on every keystroke.
   */
  const matching = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    if (!wanted) return entries;

    return entries.filter((entry) => String(entry.title || '').toLowerCase().includes(wanted));
  }, [entries, query]);

  const detailHref = (entry) =>
    `/anime?source=${encodeURIComponent(entry.providerId)}`
    + `&id=${encodeURIComponent(entry.id)}`;

  const remove = (entry) => {
    removeFromLibrary(entry);
    setEntries(getLibrary());
  };

  if (entries.length === 0) {
    return (
      <div className="library-page">
        <h1>Library</h1>
        <section className="empty-state">
          <h2>Nothing saved yet</h2>
          <p>
            Open a title and tap <strong>Add to library</strong> to keep it
            here. The library is stored on this device.
          </p>
          <Link to="/" className="btn btn-primary">Browse</Link>
        </section>
      </div>
    );
  }

  return (
    <div className="library-page">
      <h1>Library</h1>
      <p className="library-count">
        {entries.length} {entries.length === 1 ? 'title' : 'titles'}
      </p>

      <label className="list-search">
        <span className="visually-hidden">Search library</span>
        <input
          type="search"
          value={query}
          placeholder="Search library"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {/* Said plainly, because a filtered-to-nothing grid is
          indistinguishable from an empty library. */}
      {matching.length === 0 && (
        <p className="extensions-empty">Nothing saved matches “{query}”.</p>
      )}

      <div className="anime-grid">
        {matching.map((entry) => (
          <div key={`${entry.providerId}:${entry.id}`} className="library-card">
            <Link to={detailHref(entry)} className="library-card-link">
              {entry.poster
                ? <img src={entry.poster} alt="" className="library-card-poster" />
                : <div className="library-card-poster library-card-blank" aria-hidden="true" />}
              <span className="library-card-title">{entry.title}</span>
            </Link>

            <button
              type="button"
              className="library-card-remove"
              onClick={() => remove(entry)}
              aria-label={`Remove ${entry.title} from library`}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
