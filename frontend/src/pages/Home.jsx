import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AnimeCard from '../components/AnimeCard';
import SourceTabs from '../components/SourceTabs';
import { getProviders } from '../services/providers/registry';
import { getSelectedSourceKey, setSelectedSourceKey } from '../services/extensions/storage';
import '../styles/Pages.css';

/**
 * The app's front page: whatever your source shows on its own front page.
 *
 * Loads on open rather than behind a Browse click, because a media app that
 * starts empty looks broken. There is no separate browse page any more - with
 * one catalogue, browsing and searching are the same screen with and without
 * a query.
 */
export default function Home() {
  const providers = useMemo(() => getProviders(), []);
  const [searchParams, setSearchParams] = useSearchParams();

  const query = searchParams.get('q') || '';

  const [selectedId, setSelectedId] = useState(() => {
    const remembered = getSelectedSourceKey();
    const match = providers.find((provider) => provider.sourceKey === remembered);
    return (match || providers[0] || {}).id || null;
  });

  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState(query);

  const provider = providers.find((candidate) => candidate.id === selectedId) || null;

  useEffect(() => { setDraft(query); }, [query]);

  /**
   * Fetches one page from the current source.
   *
   * `append` distinguishes "load more" from a fresh search, so paging does
   * not discard what is already on screen.
   */
  const load = useCallback(async (wanted, append) => {
    if (!provider) return;

    setLoading(true);
    setError(null);

    // Every outcome settles all of the state in one pass. Clearing `loading`
    // in a finally would render a second time after the results were already
    // on screen, which is a wasted render and, in tests, an update arriving
    // after the assertions.
    try {
      const result = query
        ? await provider.search(query, wanted)
        : await provider.getLibrary(wanted);

      setItems((current) => (append ? [...current, ...result] : result));
      // Sources are unreliable about hasNextPage, so a full-looking page is
      // treated as "there may be more" and an empty one ends the list.
      setHasMore(result.length > 0);
      setPage(wanted);
      setLoading(false);
    } catch (err) {
      setError(err.message);
      if (!append) setItems([]);
      setHasMore(false);
      setLoading(false);
    }
  }, [provider, query]);

  useEffect(() => {
    setItems([]);
    setHasMore(false);
    load(1, false);
  }, [load]);

  const handleSource = (chosen) => {
    setSelectedId(chosen.id);
    setSelectedSourceKey(chosen.sourceKey);
  };

  const handleSearch = (e) => {
    e.preventDefault();
    const trimmed = draft.trim();
    setSearchParams(trimmed ? { q: trimmed } : {});
  };

  if (providers.length === 0) {
    return (
      <div className="home-page">
        <section className="empty-state">
          <h1>No sources installed</h1>
          <p>
            Animiru plays from extensions you install yourself. Add an
            extension repository and install a source to get started.
          </p>
          <Link to="/settings" className="btn btn-primary">Open Settings</Link>
        </section>
      </div>
    );
  }

  return (
    <div className="home-page">
      <SourceTabs providers={providers} selectedId={selectedId} onSelect={handleSource} />

      <form className="home-search" onSubmit={handleSearch}>
        <input
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={provider ? `Search ${provider.name}...` : 'Search...'}
          aria-label="Search"
        />
        <button type="submit" className="btn btn-primary">Search</button>
        {query && (
          <button
            type="button"
            className="btn btn-link"
            onClick={() => setSearchParams({})}
          >
            Clear
          </button>
        )}
      </form>

      <section className="catalogue">
        <h2>{query ? `Results for "${query}"` : provider && provider.name}</h2>

        {error && <p className="extensions-error">{error}</p>}

        {items.length > 0 && (
          <div className="anime-grid">
            {items.map((item) => (
              <AnimeCard key={`${item.providerId}:${item.id}`} item={item} />
            ))}
          </div>
        )}

        {loading && <p className="loading">Loading...</p>}

        {!loading && items.length === 0 && !error && (
          <p className="extensions-empty">
            {query
              ? `${provider ? provider.name : 'This source'} found nothing for "${query}".`
              : `${provider ? provider.name : 'This source'} returned no titles.`}
          </p>
        )}

        {!loading && hasMore && items.length > 0 && (
          <button
            type="button"
            className="btn btn-secondary load-more"
            onClick={() => load(page + 1, true)}
          >
            Load more
          </button>
        )}
      </section>
    </div>
  );
}
