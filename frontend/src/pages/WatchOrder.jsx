import React, { useCallback } from 'react';
import { Link } from 'react-router-dom';
import MetadataScreen from '../components/MetadataScreen';
import { getWatchOrder, findOnSourcesHref } from '../services/metadata';
import '../styles/Metadata.css';

/**
 * The whole franchise in release order, numbered from the first installment.
 *
 * Seasons, movies, OVAs and specials together, because "what do I watch
 * next" does not respect the distinction - a movie between two seasons is
 * part of the order.
 */
export default function WatchOrder() {
  const fetch = useCallback((id) => getWatchOrder(id), []);

  const render = (state) => {
    if (!state.entries || state.entries.length === 0) return null;

    return (
      <ol className="watch-order">
        {state.entries.map((entry) => (
          <li key={entry.id} className="watch-order-entry">
            <span className="watch-order-number" aria-hidden="true">{entry.position}</span>

            {/* Poster and title are one link, so tapping either finds the
                title on the source you came from. */}
            <Link
              to={findOnSourcesHref(entry.title)}
              className="watch-order-poster-link"
              aria-label={`Find ${entry.title} on your sources`}
            >
              {entry.poster
                ? <img src={entry.poster} alt="" className="watch-order-poster" />
                : <div className="watch-order-poster watch-order-blank" aria-hidden="true" />}
            </Link>

            <div className="watch-order-detail">
              <h2>
                <Link to={findOnSourcesHref(entry.title)} className="metadata-title-link">
                  {entry.title}
                </Link>
              </h2>
              {entry.titles && entry.titles.length > 1 && (
                <p className="watch-order-alt">{entry.titles[0]}</p>
              )}
              <p className="watch-order-facts">
                {[
                  entry.format,
                  entry.episodes ? `${entry.episodes} eps` : null,
                  entry.year || 'unaired'
                ].filter(Boolean).join(' | ')}
              </p>
            </div>
          </li>
        ))}
      </ol>
    );
  };

  return (
    <MetadataScreen
      title="Watch order"
      fetch={fetch}
      render={render}
      emptyMessage="AniList lists nothing else in this story."
    />
  );
}
