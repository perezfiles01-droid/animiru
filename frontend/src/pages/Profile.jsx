import React, { useState, useEffect } from 'react';
import api from '../services/api';
import '../styles/Pages.css';

export default function Profile({ user }) {
  const [watchlist, setWatchlist] = useState([]);
  const [loading, setLoading] = useState(true);
  const [preferences, setPreferences] = useState({
    theme: 'dark',
    quality: '720p',
    language: 'en'
  });

  useEffect(() => {
    const fetchWatchlist = async () => {
      try {
        const response = await api.get('/watchlist');
        setWatchlist(response.data || []);
      } catch (err) {
        console.error('Error fetching watchlist:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchWatchlist();
  }, []);

  const handlePreferenceChange = async (key, value) => {
    const updated = { ...preferences, [key]: value };
    setPreferences(updated);

    try {
      await api.put('/user/profile', updated);
    } catch (err) {
      console.error('Error saving preferences:', err);
    }
  };

  return (
    <div className="profile-page">
      <div className="profile-header">
        <h1>👤 {user?.username || 'User'}</h1>
        <p className="email">{user?.email}</p>
      </div>

      <div className="profile-sections">
        <section className="preferences-section">
          <h2>⚙️ Preferences</h2>

          <div className="preference-group">
            <label>Theme</label>
            <select
              value={preferences.theme}
              onChange={(e) => handlePreferenceChange('theme', e.target.value)}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="auto">Auto</option>
            </select>
          </div>

          <div className="preference-group">
            <label>Video Quality</label>
            <select
              value={preferences.quality}
              onChange={(e) => handlePreferenceChange('quality', e.target.value)}
            >
              <option value="1080p">1080p</option>
              <option value="720p">720p</option>
              <option value="480p">480p</option>
              <option value="auto">Auto</option>
            </select>
          </div>

          <div className="preference-group">
            <label>Language</label>
            <select
              value={preferences.language}
              onChange={(e) => handlePreferenceChange('language', e.target.value)}
            >
              <option value="en">English</option>
              <option value="es">Español</option>
              <option value="fr">Français</option>
              <option value="ja">日本語</option>
            </select>
          </div>
        </section>

        <section className="watchlist-section">
          <h2>📋 My Watchlist</h2>
          {loading ? (
            <p className="loading">Loading watchlist...</p>
          ) : watchlist.length > 0 ? (
            <div className="watchlist-items">
              {watchlist.map((item) => (
                <div key={item.animeId} className="watchlist-item">
                  <div className="item-info">
                    <p className="item-id">Anime #{item.animeId}</p>
                    <p className="item-status">Status: {item.status}</p>
                  </div>
                  <button className="item-action">Remove</button>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-message">Your watchlist is empty</p>
          )}
        </section>
      </div>
    </div>
  );
}
