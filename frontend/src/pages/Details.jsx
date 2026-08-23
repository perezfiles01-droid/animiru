import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import '../styles/Pages.css';

export default function Details() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [anime, setAnime] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [inWatchlist, setInWatchlist] = useState(false);

  useEffect(() => {
    const fetchAnime = async () => {
      try {
        const response = await api.get(`/anime/${id}`);
        setAnime(response.data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchAnime();
  }, [id]);

  const handleAddToWatchlist = async () => {
    try {
      await api.post('/watchlist', {
        animeId: parseInt(id),
        status: 'PLANNING'
      });
      setInWatchlist(true);
      alert('Added to watchlist!');
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  };

  const handleWatchNow = () => {
    navigate(`/watch/${id}`);
  };

  if (loading) return <div className="loader">Loading...</div>;
  if (error) return <div className="error">Error: {error}</div>;
  if (!anime) return <div className="error">Anime not found</div>;

  return (
    <div className="details-page">
      <div className="details-header" style={{
        backgroundImage: `url(${anime.bannerImage})`
      }}>
        <div className="details-overlay"></div>
      </div>

      <div className="details-content">
        <div className="details-poster">
          <img
            src={anime.coverImage?.large}
            alt={anime.title?.romaji}
            className="poster-image"
          />
        </div>

        <div className="details-info">
          <h1>{anime.title?.romaji || anime.title?.english}</h1>

          <div className="details-meta">
            <span className="meta-item">⭐ {anime.meanScore}/100</span>
            <span className="meta-item">📺 {anime.episodes || '?'} episodes</span>
            <span className="meta-item">⏱ {anime.duration}min/ep</span>
            <span className="meta-item">
              {anime.status === 'FINISHED' ? '✓ Finished' : '▶ Airing'}
            </span>
          </div>

          {anime.genres && (
            <div className="details-genres">
              {anime.genres.map((genre) => (
                <span key={genre} className="genre-badge">{genre}</span>
              ))}
            </div>
          )}

          <div className="details-description">
            <h3>Synopsis</h3>
            <p>{anime.description?.replace(/<[^>]*>/g, '') || 'No description available'}</p>
          </div>

          <div className="details-actions">
            <button onClick={handleWatchNow} className="btn btn-primary">
              ▶ Watch Now
            </button>
            <button
              onClick={handleAddToWatchlist}
              disabled={inWatchlist}
              className="btn btn-secondary"
            >
              {inWatchlist ? '✓ In Watchlist' : '+ Add to Watchlist'}
            </button>
          </div>

          {anime.studios && anime.studios.nodes && (
            <div className="details-studios">
              <h3>Studios</h3>
              <p>{anime.studios.nodes.map(s => s.name).join(', ')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
