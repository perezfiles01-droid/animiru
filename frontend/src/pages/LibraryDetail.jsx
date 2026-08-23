import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import VideoPlayer from '../components/VideoPlayer';
import jellyfin from '../services/providers/jellyfin';
import '../styles/Pages.css';

/**
 * Plays an item from the connected media server.
 *
 * Streams are requested per episode rather than up front: each set carries a
 * play session id, and reusing one across episodes would confuse the
 * server's session tracking.
 */
export default function LibraryDetail() {
  const { id } = useParams();
  const [item, setItem] = useState(null);
  const [episodes, setEpisodes] = useState([]);
  const [current, setCurrent] = useState(null);
  const [streams, setStreams] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);

        const detail = await jellyfin.getItem(id);
        if (cancelled) return;
        setItem(detail);

        const eps = detail.kind === 'series' ? await jellyfin.getEpisodes(id) : [];
        if (cancelled) return;
        setEpisodes(eps);

        // A movie is its own playable item; a series starts on episode one.
        const first = eps.length > 0 ? eps[0] : { id, title: detail.title };
        setCurrent(first);
        setStreams(await jellyfin.getStreams(first.id));
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const playEpisode = async (episode) => {
    try {
      setError(null);
      setCurrent(episode);
      setStreams(await jellyfin.getStreams(episode.id));
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <div className="loader">Loading...</div>;
  if (error && !item) return <div className="error">Error: {error}</div>;
  if (!item) return <div className="error">Not found</div>;

  return (
    <div className="watch-page">
      <VideoPlayer
        streams={streams}
        title={current?.title || item.title}
        poster={item.poster}
      />

      {error && <p className="error">{error}</p>}

      <div className="watch-info">
        <h2>{item.title}</h2>
        {current?.number != null && (
          <p className="episode-title">
            {current.season != null ? `Season ${current.season} · ` : ''}
            Episode {current.number}
          </p>
        )}

        {item.overview && <p className="library-overview">{item.overview}</p>}

        {episodes.length > 0 && (
          <div className="episode-list">
            <h3>Episodes</h3>
            <div className="episodes-grid">
              {episodes.map((ep) => (
                <button
                  key={ep.id}
                  className={`episode-btn ${current?.id === ep.id ? 'active' : ''}`}
                  onClick={() => playEpisode(ep)}
                  title={ep.title}
                >
                  {ep.number ?? '?'}
                </button>
              ))}
            </div>
          </div>
        )}

        <Link to="/library" className="btn btn-secondary">
          Back to library
        </Link>
      </div>
    </div>
  );
}
