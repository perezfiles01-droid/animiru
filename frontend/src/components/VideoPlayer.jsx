import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import Hls from 'hls.js';
import { subtitleUrl } from '../services/extensions/client';
import '../styles/VideoPlayer.css';

/**
 * Plays an episode, with the servers and tracks the source offered.
 *
 * A source returns one entry per server, and several of them routinely fail
 * - a host is down, or refuses a request without a Referer the browser will
 * not send. So the servers are all listed and switching is one tap, because
 * moving to another mirror is the only fix available from here.
 *
 * Subtitles are fetched and turned into a blob rather than pointed at
 * directly. A <track> from another origin needs crossOrigin on the <video>,
 * and setting that would make the browser demand CORS for the video too -
 * which most hosts do not send, so subtitles would start working and
 * playback would stop. A blob is same-origin and sidesteps the whole
 * question.
 */
export default function VideoPlayer({ streams, title, poster, onServerFailed }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const blobUrls = useRef([]);

  const options = useMemo(() => streams?.options || [], [streams]);

  const [audioKind, setAudioKind] = useState(null);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState(null);
  const [ccOn, setCcOn] = useState(false);
  const [subtitleIndex, setSubtitleIndex] = useState(0);
  const [subtitleError, setSubtitleError] = useState(null);
  const [tracks, setTracks] = useState([]);

  /** Whether the source offers both, which decides if the choice is shown. */
  const hasDub = options.some((option) => option.isDub);
  const hasSub = options.some((option) => !option.isDub);

  // Servers matching the chosen audio. With only one kind on offer there is
  // nothing to filter and the control is not rendered.
  const visible = useMemo(() => {
    if (!audioKind || !(hasDub && hasSub)) return options;
    return options.filter((option) => (audioKind === 'dub' ? option.isDub : !option.isDub));
  }, [options, audioKind, hasDub, hasSub]);

  const current = visible[selected] || visible[0] || null;
  const subtitles = current ? current.subtitles || [] : [];

  const releaseBlobs = useCallback(() => {
    blobUrls.current.forEach((url) => URL.revokeObjectURL(url));
    blobUrls.current = [];
  }, []);

  // Switching server or audio invalidates the current selection.
  useEffect(() => { setSelected(0); }, [audioKind]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !current) return undefined;

    setError(null);

    // Carry playback position across a switch, so changing server or quality
    // does not restart the episode.
    const resumeAt = video.currentTime || 0;
    const wasPlaying = !video.paused && !video.ended;

    const resume = () => {
      if (resumeAt > 0) video.currentTime = resumeAt;
      if (wasPlaying) {
        const played = video.play();
        // Autoplay can be refused; not an error worth surfacing.
        if (played && typeof played.catch === 'function') played.catch(() => {});
      }
    };

    /** A server that cannot play is reported so another can be offered. */
    const failed = (reason) => {
      setError(reason);
      if (onServerFailed) onServerFailed(current, reason);
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
        failed(data.type === Hls.ErrorTypes.NETWORK_ERROR
          ? 'This server did not respond.'
          : 'This server could not be played.');
      });

      hls.loadSource(current.url);
      hls.attachMedia(video);
    } else {
      video.src = current.url;
      video.addEventListener('loadedmetadata', resume, { once: true });
      video.addEventListener('error', () => failed('This server could not be played.'), { once: true });
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [current, onServerFailed]);

  // A different server carries different subtitles, so anything fetched for
  // the previous one is stale.
  useEffect(() => {
    releaseBlobs();
    setTracks([]);
    setSubtitleIndex(0);
    setSubtitleError(null);
  }, [current, releaseBlobs]);

  useEffect(() => releaseBlobs, [releaseBlobs]);

  /**
   * Fetches a subtitle and makes it available to the video element.
   *
   * Fetched rather than linked: see the note at the top of this file.
   */
  const loadSubtitle = useCallback(async (index) => {
    const track = subtitles[index];
    if (!track) return;

    setSubtitleError(null);
    try {
      const response = await fetch(
        subtitleUrl(track.url, current && current.headers && current.headers.Referer)
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Subtitles could not be loaded (${response.status}).`);
      }

      const blob = new Blob([await response.text()], { type: 'text/vtt' });
      const url = URL.createObjectURL(blob);
      blobUrls.current.push(url);

      setTracks((existing) => [
        ...existing.filter((entry) => entry.index !== index),
        { index, url, label: track.label }
      ]);
    } catch (err) {
      setSubtitleError(err.message);
      setCcOn(false);
    }
  }, [subtitles, current]);

  // Only the chosen track is shown; the browser will happily display two at
  // once otherwise, stacked over each other.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    for (const textTrack of video.textTracks) {
      textTrack.mode = ccOn && textTrack.label === (subtitles[subtitleIndex] || {}).label
        ? 'showing'
        : 'disabled';
    }
  }, [ccOn, subtitleIndex, tracks, subtitles]);

  const toggleCc = () => {
    if (ccOn) {
      setCcOn(false);
      return;
    }
    // Default to English where the source labelled one, since that is what
    // is usually wanted and the list is often long.
    const preferred = subtitles.findIndex((track) => track.isEnglish);
    const index = preferred === -1 ? 0 : preferred;

    setSubtitleIndex(index);
    setCcOn(true);
    if (!tracks.some((entry) => entry.index === index)) loadSubtitle(index);
  };

  const chooseSubtitle = (index) => {
    setSubtitleIndex(index);
    setCcOn(true);
    if (!tracks.some((entry) => entry.index === index)) loadSubtitle(index);
  };

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
        >
          {tracks.map((track) => (
            <track
              key={track.url}
              kind="subtitles"
              src={track.url}
              label={track.label}
              srcLang="en"
            />
          ))}
        </video>
      </div>

      <div className="player-bar">
        <span className="player-title">{title}</span>

        <div className="player-controls">
          {subtitles.length > 0 && (
            <button
              type="button"
              className={`player-cc ${ccOn ? 'active' : ''}`}
              onClick={toggleCc}
              aria-pressed={ccOn}
              title={ccOn ? 'Turn subtitles off' : 'Turn subtitles on'}
            >
              CC
            </button>
          )}

          {ccOn && subtitles.length > 1 && (
            <label className="player-select">
              Subtitles
              <select
                value={subtitleIndex}
                onChange={(e) => chooseSubtitle(Number(e.target.value))}
              >
                {subtitles.map((track, index) => (
                  <option key={track.url} value={index}>{track.label}</option>
                ))}
              </select>
            </label>
          )}

          {hasDub && hasSub && (
            <label className="player-select">
              Audio
              <select
                value={audioKind || 'sub'}
                onChange={(e) => setAudioKind(e.target.value)}
              >
                <option value="sub">Sub</option>
                <option value="dub">Dub</option>
              </select>
            </label>
          )}

          {visible.length > 1 && (
            <label className="player-select">
              Server
              <select
                value={selected}
                onChange={(e) => setSelected(Number(e.target.value))}
              >
                {visible.map((option, index) => (
                  // Keyed by id, not label: mirrors share labels, and a
                  // duplicate key makes React reuse the wrong option.
                  <option key={option.id} value={index}>
                    {option.server}
                    {option.quality ? ` · ${option.quality}` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      {subtitleError && <p className="player-error">{subtitleError}</p>}
      {error && (
        <div className="player-error">
          <p>{error}</p>
          {visible.length > 1 && (
            <p className="player-error-hint">
              Try another server — {visible.length - 1} other
              {visible.length === 2 ? '' : 's'} available.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
