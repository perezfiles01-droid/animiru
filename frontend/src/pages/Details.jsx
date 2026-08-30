import React, { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getProvider } from '../services/providers/registry';
import ExtensionErrorReport from '../components/ExtensionError';
import LibraryButton from '../components/LibraryButton';
import StatusBadge from '../components/StatusBadge';
import '../styles/Pages.css';

/**
 * One title, as the source describes it.
 *
 * Ids from a source are its own links, which contain slashes and query
 * strings, so they travel as search params rather than path segments - a
 * path would need escaping the router would then undo.
 *
 * A scraper's detail page is thinner than a metadata API's. Synopsis and
 * genres are shown when present and simply absent when not, rather than
 * rendered as empty headings.
 */
export default function Details() {
  const [searchParams] = useSearchParams();
  const sourceId = searchParams.get('source');
  const itemId = searchParams.get('id');

  const provider = useMemo(() => getProvider(sourceId), [sourceId]);

  const [item, setItem] = useState(null);
  const [episodes, setEpisodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!provider || !itemId) {
      setError(
        provider
          ? 'No title was specified.'
          : 'That source is not installed any more.'
      );
      setLoading(false);
      return undefined;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        // Both come from one getDetail call inside the provider, so asking
        // together costs one request rather than two.
        const [detail, list] = await Promise.all([
          provider.getItem(itemId),
          provider.getEpisodes(itemId)
        ]);
        if (cancelled) return;

        setItem(detail);
        setEpisodes(list);
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [provider, itemId]);

  if (loading) return <div className="loader">Loading...</div>;
  if (error) {
    return (
      <div className="details-page">
        {typeof error === 'string'
          ? <div className="error">{error}</div>
          : <ExtensionErrorReport error={error} />}
      </div>
    );
  }
  if (!item) return <div className="error">Nothing found.</div>;

  // The show's name travels to the player: it has nothing else to identify
  // what is being watched, and tracking matches AniList on this same value.
  const watchHref = (episode) =>
    `/watch?source=${encodeURIComponent(sourceId)}`
    + `&id=${encodeURIComponent(itemId)}`
    + `&ep=${encodeURIComponent(episode.id)}`
    + `&title=${encodeURIComponent((item && item.title) || '')}`;

  // The title travels with the link because AniList is matched on it, and
  // fetching the detail again purely to learn the title it already showed
  // would be a wasted request.
  const metadataHref = (path) =>
    `${path}?source=${encodeURIComponent(sourceId)}`
    + `&id=${encodeURIComponent(itemId)}`
    + `&title=${encodeURIComponent(item.title || '')}`;

  return (
    <div className="details-page">
      <div className="details-content">
        {item.poster && (
          <div className="details-poster">
            <img src={item.poster} alt={item.title} className="poster-image" />
          </div>
        )}

        <div className="details-info">
          <h1>{item.title}</h1>
          <p className="details-source">
            {provider.name}
            <StatusBadge status={item.status} />
          </p>

          <div className="details-toolbar">
            <LibraryButton
              item={{
                id: itemId,
                providerId: sourceId,
                providerName: provider.name,
                title: item.title,
                poster: item.poster,
                year: item.year
              }}
            />
          </div>

          {item.genres && item.genres.length > 0 && (
            <div className="details-genres">
              {item.genres.map((genre) => (
                <span key={genre} className="genre-badge">{genre}</span>
              ))}
            </div>
          )}

          {item.overview && (
            <div className="details-description">
              <h3>Synopsis</h3>
              <p>{item.overview.replace(/<[^>]*>/g, '')}</p>
            </div>
          )}

          <div className="details-metadata-links">
            <Link to={metadataHref('/recommendations')} className="metadata-link">
              → Recommendations
            </Link>
            <Link to={metadataHref('/watch-order')} className="metadata-link">
              → Watch order
            </Link>
          </div>

          {episodes.length > 0 ? (
            <div className="details-actions">
              <Link to={watchHref(episodes[0])} className="btn btn-primary">
                ▶ Watch {episodes[0].title}
              </Link>
            </div>
          ) : (
            <p className="extensions-empty">
              This source listed no episodes for this title.
            </p>
          )}
        </div>
      </div>

      {episodes.length > 0 && (
        <section className="episode-list">
          <h3>{episodes.length} episodes</h3>
          <div className="ext-episodes">
            {episodes.map((episode) => (
              <Link key={episode.id} to={watchHref(episode)} className="ext-episode">
                {episode.title}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
