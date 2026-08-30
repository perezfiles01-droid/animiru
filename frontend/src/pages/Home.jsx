import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AnimeCard from '../components/AnimeCard';
import SourceTabs from '../components/SourceTabs';
import SearchResults from '../components/SearchResults';
import ExtensionErrorReport from '../components/ExtensionError';
import { getProviders } from '../services/providers/registry';
import { getSelectedSourceKey, setSelectedSourceKey } from '../services/extensions/storage';
import '../styles/Pages.css';

/**
 * The app's front page: whatever your source shows on its own front page.
 *
 * Loads on open rather than behind a Browse click, because a media app that
 * starts empty looks broken.
 *
 * Browsing and searching differ deliberately. Browsing shows one source at a
 * time: catalogues have no shared ranking, so merging them makes a pile
 * nothing can order. A search names a title, so every installed source is
 * asked at once and the answers stay grouped by which source gave them -
 * picking a source and searching it alone, then repeating, was the hassle
 * this removes.
 *
 * A search can still be narrowed to one source with ?source=, which is where
 * a group's arrow leads.
 */
export default function Home() {
  const providers = useMemo(() => getProviders(), []);
  const [searchParams, setSearchParams] = useSearchParams();

  const query = searchParams.get('q') || '';
  const onlySource = searchParams.get('source') || '';

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

  const searchProviders = useMemo(() => (
    onlySource ? providers.filter((candidate) => candidate.id === onlySource) : providers
  ), [providers, onlySource]);

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
      const result = await provider.getLibrary(wanted);

      setItems((current) => (append ? [...current, ...result] : result));
      // Sources are unreliable about hasNextPage, so a full-looking page is
      // treated as "there may be more" and an empty one ends the list.
      setHasMore(result.length > 0);
      setPage(wanted);
      setLoading(false);
    } catch (err) {
      setError(err);
      if (!append) setItems([]);
      setHasMore(false);
      setLoading(false);
    }
  }, [provider]);

  useEffect(() => {
    // A query is answered by SearchResults across every source, so the
    // catalogue is only fetched when browsing.
    if (query) return;
    setItems([]);
    setHasMore(false);
    load(1, false);
  }, [load, query]);

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
      {!query && (
        <SourceTabs providers={providers} selectedId={selectedId} onSelect={handleSource} />
      )}

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

      {query ? (
        <section className="catalogue">
          <h2>Results for &ldquo;{query}&rdquo;</h2>
          <SearchResults providers={searchProviders} query={query} />
        </section>
      ) : (
        <section className="catalogue">
          <h2>{provider && provider.name}</h2>

          {error && <ExtensionErrorReport error={error} />}

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
              {provider ? provider.name : 'This source'} returned no titles.
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
      )}
    </div>
  );
}
