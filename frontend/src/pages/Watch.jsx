import React, { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import VideoPlayer from '../components/VideoPlayer';
import { getProvider } from '../services/providers/registry';
import ExtensionErrorReport from '../components/ExtensionError';
import '../styles/Pages.css';

/**
 * Plays one episode from the source it came from.
 *
 * Two calls, deliberately separate: the episode list so you can move between
 * episodes without going back, and the video for the one you are watching.
 * Resolving a video is the slow part - a source usually has to load the
 * episode page and then an embedded host - so the list appears first and
 * playback follows.
 */
export default function Watch() {
  const [searchParams, setSearchParams] = useSearchParams();
  const sourceId = searchParams.get('source');
  const itemId = searchParams.get('id');
  const episodeId = searchParams.get('ep');

  const provider = useMemo(() => getProvider(sourceId), [sourceId]);

  const [episodes, setEpisodes] = useState([]);
  const [streams, setStreams] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const episode = episodes.find((candidate) => candidate.id === episodeId) || null;

  useEffect(() => {
    if (!provider || !itemId) return undefined;

    let cancelled = false;
    provider.getEpisodes(itemId)
      .then((list) => { if (!cancelled) setEpisodes(list); })
      // The list is a convenience; failing to load it must not stop the
      // episode the user actually asked for from playing.
      .catch(() => {});

    return () => { cancelled = true; };
  }, [provider, itemId]);

  useEffect(() => {
    if (!provider || !episodeId) {
      setError(
        provider
          ? 'No episode was specified.'
          : 'That source is not installed any more.'
      );
      setLoading(false);
      return undefined;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      setStreams(null);

      try {
        const found = await provider.getStreams(episodeId);
        if (cancelled) return;

        if (!found.options || found.options.length === 0) {
          setError('This source found no video for that episode.');
        } else {
          setStreams(found);
        }
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [provider, episodeId]);

  const title = episode ? episode.title : 'Episode';

  const select = (chosen) => {
    setSearchParams({ source: sourceId, id: itemId, ep: chosen.id });
  };

  return (
    <div className="watch-page">
      {streams && <VideoPlayer streams={streams} title={title} />}

      {loading && <div className="loader">Finding video...</div>}

      {error && (
        <div className="watch-error">
          {typeof error === 'string'
            ? <p className="extensions-error">{error}</p>
            : <ExtensionErrorReport error={error} />}
          {itemId && sourceId && (
            <Link
              to={`/anime?source=${encodeURIComponent(sourceId)}&id=${encodeURIComponent(itemId)}`}
              className="btn btn-secondary"
            >
              Back to episodes
            </Link>
          )}
        </div>
      )}

      <div className="watch-info">
        <h2>{title}</h2>
        {provider && <p className="details-source">{provider.name}</p>}

        {episodes.length > 0 && (
          <div className="ext-episodes">
            {episodes.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                className={`ext-episode ${candidate.id === episodeId ? 'active' : ''}`}
                onClick={() => select(candidate)}
              >
                {candidate.title}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
