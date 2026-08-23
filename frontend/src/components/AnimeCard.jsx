import React from 'react';
import { Link } from 'react-router-dom';
import '../styles/AnimeCard.css';

export default function AnimeCard({ anime }) {
  return (
    <Link to={`/anime/${anime.id}`} className="anime-card">
      <div className="card-image-container">
        <img
          src={anime.coverImage?.large || 'https://via.placeholder.com/225x320'}
          alt={anime.title?.romaji || anime.title?.english}
          className="card-image"
          loading="lazy"
        />
        <div className="card-overlay">
          <div className="card-rating">⭐ {anime.meanScore}/100</div>
          <div className="card-episodes">
            📺 {anime.episodes || '?'} eps
          </div>
        </div>
      </div>
      <div className="card-info">
        <h3 className="card-title">
          {anime.title?.romaji || anime.title?.english || 'Unknown'}
        </h3>
        {anime.genres && (
          <p className="card-genres">
            {anime.genres.slice(0, 2).join(', ')}
          </p>
        )}
        <p className="card-status">
          {anime.status === 'FINISHED' ? '✓ Finished' : '▶ Airing'}
        </p>
      </div>
    </Link>
  );
}
