import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AnimeCard from '../components/AnimeCard';
import SourceTabs from '../components/SourceTabs';
import SearchResults from '../components/SearchResults';
import SourceFilter from '../components/SourceFilter';
import Discover from '../components/Discover';
import FilterPanel from '../components/FilterPanel';
import FrontRows from '../components/FrontRows';
import ExtensionErrorReport from '../components/ExtensionError';
import { getProviders } from '../services/providers/registry';
import {
  getSelectedSourceKey, setSelectedSourceKey,
  getSearchSourceKeys, setSearchSourceKeys
} from '../services/extensions/storage';
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
 * A search can be narrowed to some of them with the filter beside the box,
 * or to exactly one with ?source=, which is where a group's arrow leads.
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  // The applied filter, not the one being edited: the panel keeps its own
  // draft so closing it without applying changes nothing.
  const [filter, setFilter] = useState({ season: '', year: new Date().getFullYear() });

  const provider = providers.find((candidate) => candidate.id === selectedId) || null;

  /**
   * Remembered as source keys rather than provider ids: an id is derived
   * from the installed source and would not survive a reinstall, which
   * would silently widen a search the user had narrowed.
   */
  const [searchSourceIds, setSearchSourceIds] = useState(() => {
    const remembered = getSearchSourceKeys();
    return providers
      .filter((candidate) => remembered.includes(candidate.sourceKey))
      .map((candidate) => candidate.id);
  });

  const searchProviders = useMemo(() => {
    // ?source= pins one source and wins: it is where a result group's arrow
    // leads, and it would be strange for that to land somewhere wider.
    if (onlySource) {
      return providers.filter((candidate) => candidate.id === onlySource);
    }

    if (searchSourceIds.length === 0) return providers;

    const chosen = providers.filter((candidate) => searchSourceIds.includes(candidate.id));

    // A selection naming only uninstalled sources would search nothing and
    // look like a broken search, so it falls back to all of them.
    return chosen.length > 0 ? chosen : providers;
  }, [providers, onlySource, searchSourceIds]);

  const handleSearchSources = (ids) => {
    setSearchSourceIds(ids);
    setSearchSourceKeys(
      providers.filter((candidate) => ids.includes(candidate.id))
        .map((candidate) => candidate.sourceKey)
    );
  };

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
        <div className="home-toolbar">
          <SourceTabs providers={providers} selectedId={selectedId} onSelect={handleSource} />

          {/* Only here. Filtering by season means nothing on Library, on
              History or in Settings, and a control that does nothing on the
              screen you are looking at is worse than no control. */}
          <FilterPanel
            open={filtersOpen}
            season={filter.season}
            year={filter.year}
            onOpen={() => setFiltersOpen(true)}
            onClose={() => setFiltersOpen(false)}
            onApply={setFilter}
          />
        </div>
      )}

      <form className="home-search" onSubmit={handleSearch}>
        <input
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Search anime..."
          aria-label="Search"
        />
        <SourceFilter
          providers={providers}
          selected={searchSourceIds}
          onChange={handleSearchSources}
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

      {!query && <Discover season={filter.season} year={filter.year} />}

      {/* Above the source's own catalogue, not instead of it: these rows
          are somewhere to start, and the catalogue is what actually
          plays. */}
      {!query && !filter.season && <FrontRows />}

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
