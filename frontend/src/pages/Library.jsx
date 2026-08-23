import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import jellyfin from '../services/providers/jellyfin';
import '../styles/Pages.css';

/**
 * Browses the connected Jellyfin server.
 *
 * Kept separate from Browse, which searches AniList. AniList is metadata
 * only, so its results are never playable here; the library is the source
 * that actually streams.
 */
export default function Library() {
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const configured = jellyfin.isConfigured();

  const load = useCallback(async (searchTerm) => {
    if (!jellyfin.isConfigured()) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      setItems(
        searchTerm ? await jellyfin.search(searchTerm) : await jellyfin.getLibrary()
      );
    } catch (err) {
      setError(err.message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load('');
  }, [load]);

  const handleSearch = (e) => {
    e.preventDefault();
    load(query.trim());
  };

  if (!configured) {
    return (
      <div className="library-page">
        <h1>Library</h1>
        <div className="library-empty">
          <p>No media server connected.</p>
          <p className="settings-help">
            Connect a Jellyfin server to browse and stream your own library
            here, with selectable quality.
          </p>
          <Link to="/settings" className="btn btn-primary">
            Open settings
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="library-page">
      <h1>Library</h1>

      <form onSubmit={handleSearch} className="library-search">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your library..."
          autoCapitalize="none"
        />
        <button type="submit" className="btn btn-primary">
          Search
        </button>
      </form>

      {loading && <p className="loading">Loading...</p>}
      {error && <p className="error">Error: {error}</p>}

      {!loading && items.length > 0 && (
        <div className="anime-grid">
          {items.map((item) => (
            <Link
              key={item.id}
              to={`/library/${item.id}`}
              className="anime-card"
            >
              <div className="card-image">
                {item.poster ? (
                  <img src={item.poster} alt={item.title} loading="lazy" />
                ) : (
                  <div className="card-placeholder">{item.title}</div>
                )}
              </div>
              <div className="card-info">
                <h3>{item.title}</h3>
                {item.year && <p className="genres">{item.year}</p>}
              </div>
            </Link>
          ))}
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <p className="no-results">
          Nothing here yet. Add anime to your Jellyfin library and it will show
          up.
        </p>
      )}
    </div>
  );
}
