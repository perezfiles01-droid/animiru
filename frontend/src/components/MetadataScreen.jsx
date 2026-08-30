import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import MetadataMatch from './MetadataMatch';
import { resolveMatch } from '../services/metadata';
import '../styles/Metadata.css';

/**
 * The shared shell of the two metadata screens.
 *
 * Both do the same three things - work out which AniList entry this is,
 * fetch one thing about it, and let a wrong match be corrected - and differ
 * only in what they fetch and how they draw it. Writing that twice would
 * mean fixing the matching twice.
 */
export default function MetadataScreen({ title, fetch: fetchData, render, emptyMessage }) {
  const [searchParams] = useSearchParams();
  const providerId = searchParams.get('source');
  const itemId = searchParams.get('id');
  const sourceTitle = searchParams.get('title') || '';

  const [state, setState] = useState({ status: 'loading' });

  const load = useCallback(async (chosen) => {
    setState({ status: 'loading' });

    const resolved = chosen
      ? { match: chosen, candidates: [chosen], corrected: true }
      : await resolveMatch({ providerId, itemId, title: sourceTitle });

    if (!resolved.match) {
      setState({ status: 'unmatched', ...resolved });
      return;
    }

    const result = await fetchData(resolved.match.id);
    setState({ status: result.error ? 'error' : 'ready', ...resolved, ...result });
  }, [providerId, itemId, sourceTitle, fetchData]);

  useEffect(() => { load(null); }, [load]);

  const backHref = `/anime?source=${encodeURIComponent(providerId || '')}`
    + `&id=${encodeURIComponent(itemId || '')}`;

  const matchBar = state.status !== 'loading' && (
    <MetadataMatch
      providerId={providerId}
      itemId={itemId}
      match={state.match || null}
      candidates={state.candidates || []}
      corrected={state.corrected}
      onChange={(entry) => load(entry)}
    />
  );

  return (
    <div className="metadata-page">
      <header className="metadata-header">
        <Link to={backHref} className="metadata-back" aria-label="Back">←</Link>
        <h1>{title}</h1>
      </header>

      {matchBar}

      {state.status === 'loading' && <p className="loading">Loading...</p>}

      {/* Metadata failing is not the source failing, and saying so stops a
          working title looking broken. */}
      {state.status === 'error' && (
        <p className="metadata-error">
          {state.error} The title itself still works - this only affects
          watch order and recommendations.
        </p>
      )}

      {state.status === 'unmatched' && (
        <p className="metadata-error">
          {state.error
            ? state.error
            : `Nothing on AniList matched "${sourceTitle}". `
              + 'Sources and AniList often spell a title differently.'}
        </p>
      )}

      {state.status === 'ready' && (
        render(state) || <p className="extensions-empty">{emptyMessage}</p>
      )}
    </div>
  );
}
