import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import '../styles/VideoPlayer.css';

/**
 * Plays an HLS stream with a working quality selector.
 *
 * The selector switches between distinct stream URLs supplied by the
 * provider, rather than trying to steer the player. That is what makes it
 * real: a source returns a separate URL per quality, so picking "720p"
 * plays a different file. An earlier version of this component rendered the
 * same dropdown over a single source and changed nothing at all.
 *
 * A source that returns one option gets no control, since there would be
 * nothing to switch between.
 */
export default function VideoPlayer({ streams, title, poster }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState(null);

  const options = streams?.options || [];
  const current = options[selected];

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !current) return undefined;

    setError(null);

    // Carry playback position across a quality change, so switching does not
    // restart the episode.
    const resumeAt = video.currentTime || 0;
    const wasPlaying = !video.paused && !video.ended;

    const resume = () => {
      if (resumeAt > 0) {
        video.currentTime = resumeAt;
      }
      if (wasPlaying) {
        const played = video.play();
        // Autoplay can be refused; that is not an error worth surfacing.
        if (played && typeof played.catch === 'function') played.catch(() => {});
      }
    };

    // Safari and most Android WebViews play HLS natively, and doing so keeps
    // hardware decoding. Only fall back to MSE when the browser cannot.
    const nativeHls = video.canPlayType('application/vnd.apple.mpegurl');

    if (current.type === 'hls' && !nativeHls && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true });
      hlsRef.current = hls;

      hls.on(Hls.Events.MANIFEST_PARSED, resume);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        // Non-fatal errors are recovered internally by hls.js.
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          setError('Lost connection to the stream.');
        } else {
          setError('This stream could not be played.');
        }
      });

      hls.loadSource(current.url);
      hls.attachMedia(video);
    } else {
      video.src = current.url;
      video.addEventListener('loadedmetadata', resume, { once: true });
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [current]);

  if (options.length === 0) {
    return (
      <div className="player player--empty">
        <p>No playable stream for this episode.</p>
      </div>
    );
  }

  return (
    <div className="player">
      <div className="player-frame">
        <video
          ref={videoRef}
          className="player-video"
          controls
          playsInline
          poster={poster}
        />
      </div>

      <div className="player-bar">
        <span className="player-title">{title}</span>

        {options.length > 1 && (
          <label className="player-quality">
            Quality
            <select
              value={selected}
              onChange={(e) => setSelected(Number(e.target.value))}
            >
              {options.map((option, index) => (
                <option key={option.label} value={index}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {error && <p className="player-error">{error}</p>}
    </div>
  );
}
