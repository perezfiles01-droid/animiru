import React, { useState, useEffect } from 'react';
import AnimeCard from '../components/AnimeCard';
import api from '../services/api';
import '../styles/Pages.css';

export default function Home() {
  const [trending, setTrending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchTrending = async () => {
      try {
        const response = await api.get('/anime/browse/trending?page=1');
        setTrending(response.data.media || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchTrending();
  }, []);

  return (
    <div className="home-page">
      <section className="hero">
        <div className="hero-content">
          <h1>Welcome to Animiru</h1>
          <p>Discover and watch your favorite anime</p>
        </div>
      </section>

      <section className="trending-section">
        <h2>🔥 Trending Now</h2>
        {loading && <p className="loading">Loading anime...</p>}
        {error && <p className="error">Error: {error}</p>}
        {!loading && trending.length > 0 && (
          <div className="anime-grid">
            {trending.map((anime) => (
              <AnimeCard key={anime.id} anime={anime} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
