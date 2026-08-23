import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import VideoPlayer from '../components/VideoPlayer';
import { getAnimeById } from '../services/anilist';
import '../styles/Pages.css';

export default function Watch() {
  const { id } = useParams();
  const [anime, setAnime] = useState(null);
  const [episode, setEpisode] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchAnime = async () => {
      try {
        setAnime(await getAnimeById(id));
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchAnime();
  }, [id]);

  if (loading) return <div className="loader">Loading...</div>;
  if (error) return <div className="error">Error: {error}</div>;
  if (!anime) return <div className="error">Anime not found</div>;

  const videoUrl = `https://stream.example.com/anime/${id}/episode/${episode}/stream.m3u8`;

  return (
    <div className="watch-page">
      <VideoPlayer
        episodeUrl={videoUrl}
        title={anime.title?.romaji}
        episodeNumber={episode}
      />

      <div className="watch-info">
        <h2>{anime.title?.romaji}</h2>
        <p className="episode-title">Episode {episode}</p>

        <div className="episode-list">
          <h3>Episodes</h3>
          <div className="episodes-grid">
            {Array.from({ length: anime.episodes || 12 }).map((_, i) => (
              <button
                key={i + 1}
                className={`episode-btn ${episode === i + 1 ? 'active' : ''}`}
                onClick={() => setEpisode(i + 1)}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
