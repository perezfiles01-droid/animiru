import React from 'react';
import { embedUrl } from '../services/youtube';
import '../styles/YouTubePlayer.css';

/**
 * Embeds a YouTube video in a responsive 16:9 frame.
 *
 * Quality is chosen from the player's own gear menu, which offers up to
 * 1080p. There is deliberately no custom quality selector here: YouTube
 * deprecated programmatic quality control, so any dropdown this component
 * rendered would be decorative.
 *
 * `allowFullScreen` needs MainActivity's WebChromeClient to implement
 * onShowCustomView, otherwise the fullscreen button does nothing in the
 * Android build.
 */
export default function YouTubePlayer({ videoId, title, label }) {
  if (!videoId) {
    return (
      <div className="yt-player yt-player--empty">
        <p>No video available for this title.</p>
      </div>
    );
  }

  return (
    <div className="yt-player">
      <div className="yt-frame">
        <iframe
          src={embedUrl(videoId)}
          title={title || 'Anime video'}
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
      {label && <p className="yt-label">{label}</p>}
    </div>
  );
}
