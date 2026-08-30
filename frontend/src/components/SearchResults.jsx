import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import AnimeCard from './AnimeCard';
import ExtensionErrorReport from './ExtensionError';
import '../styles/Pages.css';

/**
 * One search, every installed source.
 *
 * Results stay grouped by the source that returned them rather than merged
 * into one list. Two scrapers share no ids and no ranking, so a merged list
 * could not be ordered honestly or deduplicated - and knowing which source a
 * result came from is what tells you where it will play from.
 *
 * Sources are searched in parallel and each row appears as its own answer
 * arrives, so one slow site does not hold up the rest, and one broken source
 * shows its error in its own row instead of emptying the page.
 */

/** How many results a row shows before pointing into that source. */
const PREVIEW = 12;

export default function SearchResults({ providers, query }) {
  const [results, setResults] = useState({});
  // Identifies the search a response belongs to, so answers from a previous
  // query cannot land in the current one.
  const searchId = useRef(0);

  useEffect(() => {
    if (!query || providers.length === 0) {
      setResults({});
      return undefined;
    }

    searchId.current += 1;
    const current = searchId.current;

    setResults(Object.fromEntries(
      providers.map((provider) => [provider.id, { loading: true, items: [], error: null }])
    ));

    // Fired together rather than awaited in turn: searching five sources one
    // after another takes five times as long as searching them at once.
    for (const provider of providers) {
      provider.search(query, 1)
        .then((items) => {
          if (searchId.current !== current) return;
          setResults((all) => ({
            ...all,
            [provider.id]: { loading: false, items, error: null }
          }));
        })
        .catch((error) => {
          if (searchId.current !== current) return;
          setResults((all) => ({
            ...all,
            [provider.id]: { loading: false, items: [], error }
          }));
        });
    }

    // A search in flight when the query changes must not overwrite the new
    // one; bumping the id on cleanup makes every pending answer stale.
    return () => { searchId.current += 1; };
  }, [providers, query]);

  if (!query) return null;

  const finished = providers.filter((p) => results[p.id] && !results[p.id].loading);
  const found = finished.filter((p) => results[p.id].items.length > 0);

  return (
    <div className="search-results">
      {finished.length === providers.length && found.length === 0 && (
        <p className="extensions-empty">
          Nothing found for &ldquo;{query}&rdquo; in any installed source.
        </p>
      )}

      {providers.map((provider) => {
        const result = results[provider.id];
        if (!result) return null;

        // A source that finished with nothing and no error is silent rather
        // than a row of empty space per source.
        if (!result.loading && !result.error && result.items.length === 0) return null;

        return (
          <section key={provider.id} className="search-group">
            <header className="search-group-header">
              <div className="search-group-title">
                <h3>{provider.name}</h3>
                {provider.lang && (
                  <span className="search-group-lang">
                    {String(provider.lang).toUpperCase()}
                  </span>
                )}
              </div>

              {result.items.length > PREVIEW && (
                <Link
                  className="search-group-more"
                  to={`/?q=${encodeURIComponent(query)}&source=${encodeURIComponent(provider.id)}`}
                  aria-label={`All results from ${provider.name}`}
                >
                  →
                </Link>
              )}
            </header>

            {result.loading && <p className="loading">Searching {provider.name}...</p>}

            {result.error && (
              <ExtensionErrorReport error={result.error} compact />
            )}

            {result.items.length > 0 && (
              <div className="search-row">
                {result.items.slice(0, PREVIEW).map((item) => (
                  <div className="search-row-item" key={`${item.providerId}:${item.id}`}>
                    <AnimeCard item={item} />
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
