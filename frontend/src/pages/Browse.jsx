import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import AnimeCard from '../components/AnimeCard';
import api from '../services/api';
import '../styles/Pages.css';

export default function Browse() {
  const [searchParams] = useSearchParams();
  const [anime, setAnime] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);

  const query = searchParams.get('q') || '';

  useEffect(() => {
    const fetchAnime = async () => {
      try {
        setLoading(true);
        let response;

        if (query) {
          response = await api.get(`/anime/search?q=${query}&page=${page}`);
          setAnime(response.data.media || []);
        } else {
          response = await api.get(`/anime/browse/trending?page=${page}`);
          setAnime(response.data.media || []);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchAnime();
  }, [query, page]);

  return (
    <div className="browse-page">
      <div className="browse-header">
        <h1>{query ? `Search: ${query}` : 'Browse Anime'}</h1>
      </div>

      {loading && <p className="loading">Loading...</p>}
      {error && <p className="error">Error: {error}</p>}

      {!loading && anime.length > 0 && (
        <>
          <div className="anime-grid">
            {anime.map((item) => (
              <AnimeCard key={item.id} anime={item} />
            ))}
          </div>

          <div className="pagination">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="page-btn"
            >
              ← Previous
            </button>
            <span className="page-info">Page {page}</span>
            <button
              onClick={() => setPage(p => p + 1)}
              className="page-btn"
            >
              Next →
            </button>
          </div>
        </>
      )}

      {!loading && anime.length === 0 && (
        <p className="no-results">No anime found. Try another search!</p>
      )}
    </div>
  );
}
