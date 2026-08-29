import React from 'react';
import { Link } from 'react-router-dom';
import '../styles/AnimeCard.css';

/**
 * One entry in a source's catalogue.
 *
 * Takes the provider contract's CatalogItem, so every source renders the
 * same way. A scraper knows a title and usually a poster; it rarely knows a
 * score, an episode count or an airing status, so nothing here invents one -
 * an empty overlay is better than "⭐ undefined/100".
 */
export default function AnimeCard({ item }) {
  const href = `/anime?source=${encodeURIComponent(item.providerId)}`
    + `&id=${encodeURIComponent(item.id)}`;

  return (
    <Link to={href} className="anime-card">
      <div className="card-image-container">
        {item.poster ? (
          <img
            src={item.poster}
            alt={item.title}
            className="card-image"
            loading="lazy"
            // A source's images live on its own site and go missing often.
            onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
          />
        ) : (
          <div className="card-image card-image-empty" aria-hidden="true" />
        )}
      </div>
      <div className="card-info">
        <h3 className="card-title">{item.title}</h3>
      </div>
    </Link>
  );
}
