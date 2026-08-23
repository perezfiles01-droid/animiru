import React, { useRef, useState, useEffect } from 'react';
import '../styles/VideoPlayer.css';

export default function VideoPlayer({ episodeUrl, title, episodeNumber }) {
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [quality, setQuality] = useState('auto');
  const [volume, setVolume] = useState(1);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !episodeUrl) return;

    // For demo purposes, use a placeholder or actual stream URL
    video.src = episodeUrl;

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);
    };

    const handleLoadedMetadata = () => {
      setDuration(video.duration);
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [episodeUrl]);

  const togglePlayPause = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleProgressChange = (e) => {
    const newTime = (e.target.value / 100) * duration;
    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return '0:00';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return hours > 0
      ? `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
      : `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="video-player-container">
      <div className="video-wrapper">
        <video
          ref={videoRef}
          className="video-element"
          onClick={togglePlayPause}
          poster={`https://via.placeholder.com/1280x720?text=${title}+E${episodeNumber}`}
        />
        <div className="player-controls">
          <div className="progress-bar">
            <input
              type="range"
              min="0"
              max="100"
              value={duration ? (currentTime / duration) * 100 : 0}
              onChange={handleProgressChange}
              className="progress-slider"
            />
          </div>

          <div className="controls-bottom">
            <div className="left-controls">
              <button
                className="control-btn play-btn"
                onClick={togglePlayPause}
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? '⏸' : '▶'}
              </button>

              <div className="volume-control">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={volume}
                  onChange={(e) => {
                    setVolume(e.target.value);
                    videoRef.current.volume = e.target.value;
                  }}
                  className="volume-slider"
                />
              </div>

              <span className="time-display">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>

            <div className="right-controls">
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
                className="quality-select"
              >
                <option value="auto">Auto</option>
                <option value="1080p">1080p</option>
                <option value="720p">720p</option>
                <option value="480p">480p</option>
              </select>

              <button
                className="fullscreen-btn"
                onClick={() => videoRef.current?.requestFullscreen?.()}
                title="Fullscreen"
              >
                ⛶
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
