import React, { useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import MetadataScreen from '../components/MetadataScreen';
import { getRecommendations, findOnSourcesHref } from '../services/metadata';
import '../styles/Metadata.css';

/**
 * What people who watched this also recommend.
 *
 * The percentage is relative to the strongest recommendation for this
 * title, not an absolute score - it answers "how strongly, compared with
 * the other suggestions here", which is the only reading a vote count
 * supports.
 */
export default function Recommendations() {
  const [searchParams] = useSearchParams();
  const providerId = searchParams.get('source');

  const fetch = useCallback((id) => getRecommendations(id), []);

  const render = (state) => {
    if (!state.results || state.results.length === 0) return null;

    return (
      <ul className="recommendations">
        {state.results.map((entry) => (
          <li key={entry.id} className="recommendation">
            <Link
              to={findOnSourcesHref(entry.title, providerId)}
              className="recommendation-poster-link"
              aria-label={`Find ${entry.title} on your sources`}
            >
              {entry.poster
                ? <img src={entry.poster} alt="" className="recommendation-poster" />
                : <div className="recommendation-poster recommendation-blank" aria-hidden="true" />}
            </Link>

            <div className="recommendation-detail">
              <h2>
                {entry.percent !== null && (
                  <span className="recommendation-percent">{entry.percent}%</span>
                )}
                <Link to={findOnSourcesHref(entry.title, providerId)} className="metadata-title-link">
                  {entry.title}
                </Link>
              </h2>

              {entry.description && (
                <p className="recommendation-synopsis">{entry.description}</p>
              )}

              {entry.genres && entry.genres.length > 0 && (
                <p className="recommendation-genres">
                  {entry.genres.slice(0, 3).map((genre) => (
                    <span key={genre} className="genre-badge">{genre}</span>
                  ))}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <MetadataScreen
      title="Recommendations"
      fetch={fetch}
      render={render}
      emptyMessage="AniList has no recommendations for this title yet."
    />
  );
}
