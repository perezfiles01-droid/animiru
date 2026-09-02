import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import Hls from 'hls.js';
import { subtitleUrl } from '../services/extensions/client';
import { toVtt } from '../services/subtitles';
import { preferredSubtitleIndex } from '../services/providers/extension';
import '../styles/VideoPlayer.css';

/** How often playback position is reported while an episode plays. */
const REPORT_EVERY_MS = 5000;

/**
 * Plays an episode, with the servers and tracks the source offered.
 *
 * A source returns one entry per server, and several of them routinely fail
 * - a host is down, or refuses a request without a Referer the browser will
 * not send. So the servers are all listed and switching is one tap, because
 * moving to another mirror is the only fix available from here.
 *
 * A server that fails before playback begins is left behind automatically:
 * there is nothing to lose by moving on, and a dead frame with an error
 * under it asks the user to do what the app can do itself. Once playback has
 * started the choice becomes theirs, because a mid-episode failure is often
 * a passing network problem and switching would throw away their position
 * for nothing.
 *
 * Subtitles start on. An episode without them is the exception rather than
 * the intent, so the player picks a track - the one the source marked, else
 * an English one - and shows it. CC turns them off, and that choice sticks
 * across servers and episodes until it is turned back on.
 *
 * Subtitles are fetched and turned into a blob rather than pointed at
 * directly. A <track> from another origin needs crossOrigin on the <video>,
 * and setting that would make the browser demand CORS for the video too -
 * which most hosts do not send, so subtitles would start working and
 * playback would stop. A blob is same-origin and sidesteps the whole
 * question.
 */
/**
 * What a <video> element's failure actually was.
 *
 * The native path had one handler and one sentence, so a CDN refusing the
 * request without a Referer, a host that no longer exists, and a codec the
 * device cannot decode all read as "This server could not be played". Three
 * different problems - one wanting a header, one wanting the source retired,
 * one wanting nothing - were indistinguishable on screen and in a
 * screenshot of it.
 *
 * MediaError.code has said which all along. The hls.js branch below already
 * separates a network failure from the rest; this is the native path, the
 * one Android takes, catching up.
 *
 * The host is named because it is the part worth acting on: the stream
 * rarely comes from the site the source is named after, and knowing which
 * CDN refused is the difference between a header problem and a dead source.
 */
export function describeMediaError(error, url) {
  let host = '';
  try {
    host = new URL(url).host;
  } catch (err) {
    // Not a URL worth quoting back; the reason still is.
  }

  const where = host ? ` from ${host}` : '';
  const code = error && typeof error.code === 'number' ? error.code : null;

  // 2, 3 and 4 are MEDIA_ERR_NETWORK, _DECODE and _SRC_NOT_SUPPORTED. The
  // numbers are used directly: the MediaError constants are not defined in
  // every environment this runs in, jsdom among them.
  if (code === 2) {
    return `This server did not respond${where}.`
      + ' The host refused the request or is unreachable.';
  }

  if (code === 3) {
    return `This server sent something the device could not decode${where}.`;
  }

  if (code === 4) {
    return `This server offered nothing playable${where}.`
      + ' The address answered, but not with a video this device can play.';
  }

  return `This server could not be played${where}.`;
}

export default function VideoPlayer({
  streams, title, poster, onServerFailed, onExhausted,
  startAt = 0, mediaKey, onProgress
}) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const blobUrls = useRef([]);

  const options = useMemo(() => streams?.options || [], [streams]);

  /**
   * Where playback is, kept outside React.
   *
   * The element cannot be asked: switching server tears the old source down
   * with load(), which resets currentTime to zero before the next effect
   * runs. Reading it there returned 0 every time, so the position was
   * quietly lost on every switch despite the code that meant to carry it.
   */
  const positionRef = useRef(startAt || 0);
  const durationRef = useRef(0);

  const [audioKind, setAudioKind] = useState(null);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState(null);
  // On unless the user says otherwise. `ccChosen` records that they did, so
  // moving to another server does not quietly switch subtitles back on.
  const [ccOn, setCcOn] = useState(true);
  const ccChosen = useRef(false);
  const [subtitleIndex, setSubtitleIndex] = useState(0);
  const [subtitleError, setSubtitleError] = useState(null);
  const [tracks, setTracks] = useState([]);

  // Servers already known not to work, so a fallback does not return to one
  // and the list can say which are dead.
  const [deadServers, setDeadServers] = useState([]);
  const [autoSwitched, setAutoSwitched] = useState(null);
  // Whether anything has played. Before it has, a failure is safe to skip;
  // after it, switching costs the user their position.
  const startedRef = useRef(false);

  // The failure handler needs the current server list and what has already
  // failed, but must not make the playback effect depend on them: recording
  // a dead server would then tear down and reload the video, resetting the
  // very flag that decides whether switching is safe.
  const switchingRef = useRef({ visible: [], selected: 0, dead: [] });

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

  /**
   * The distinct qualities on offer, best first.
   *
   * Sources put the resolution and the server in one string, so a single
   * "Server" menu listing those strings was really showing quality. The two
   * are separated here and offered as their own controls.
   */
  const qualities = useMemo(() => {
    const byName = new Map();
    for (const option of visible) {
      const name = option.quality || 'Auto';
      const height = option.height || 0;
      if (!byName.has(name) || byName.get(name) < height) byName.set(name, height);
    }
    return [...byName.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);
  }, [visible]);

  /**
   * A name per stream for the Server menu, in the order the source listed
   * them.
   *
   * One server offering 1080p and 720p is one entry - quality is its own
   * control. Two mirrors offering the same quality under the same name are
   * two entries, numbered, because they are genuinely different streams and
   * collapsing them would leave no way to reach the second by hand.
   */
  const serverKeys = useMemo(() => {
    const counts = new Map();
    return visible.map((option) => {
      const pair = `${option.server}\u0000${option.quality || 'Auto'}`;
      const seen = counts.get(pair) || 0;
      counts.set(pair, seen + 1);
      return seen === 0 ? option.server : `${option.server} (${seen + 1})`;
    });
  }, [visible]);

  const servers = useMemo(() => {
    const seen = [];
    for (const key of serverKeys) if (!seen.includes(key)) seen.push(key);
    return seen;
  }, [serverKeys]);

  const currentQuality = current ? current.quality || 'Auto' : null;
  const currentServer = serverKeys[selected] ?? (current ? current.server : null);

  /**
   * Moves to another stream, keeping whichever of quality and server the
   * user did not just change.
   *
   * Not every server carries every quality, so the pairing asked for may not
   * exist. `prefer` names the control the user just used: that one is
   * honoured and the other gives way, rather than the change doing nothing.
   *
   * @param {string} prefer 'quality' or 'server'
   */
  const choose = useCallback((quality, server, prefer) => {
    const matchesQuality = (option) => (option.quality || 'Auto') === quality;

    const exact = visible.findIndex(
      (option, index) => matchesQuality(option) && serverKeys[index] === server
    );
    const fallback = prefer === 'server'
      ? serverKeys.indexOf(server)
      : visible.findIndex(matchesQuality);

    const index = exact === -1 ? fallback : exact;
    if (index === -1) return;
    setAutoSwitched(null);
    setSelected(index);
  }, [visible, serverKeys]);
  // Memoised because an effect keys on it: rebuilt every render, that effect
  // would re-run every render, and it sets state.
  const subtitles = useMemo(() => (current ? current.subtitles || [] : []), [current]);

  switchingRef.current = { visible, selected, dead: deadServers };

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
    startedRef.current = false;

    // Carry playback position across a switch, so changing server or quality
    // does not restart the episode - and, on the first attach, resume where
    // the last sitting ended.
    const resumeAt = positionRef.current || 0;

    const onPlaying = () => { startedRef.current = true; };
    video.addEventListener('playing', onPlaying);

    /**
     * Remembers the position as it moves, and tells the page about it.
     *
     * Reported no more than once every few seconds: a timeupdate fires four
     * times a second, and writing to storage that often would be wasteful
     * for something only read when the episode is opened again.
     */
    let lastReported = 0;
    const onTimeUpdate = () => {
      positionRef.current = video.currentTime || 0;
      durationRef.current = video.duration || 0;

      const now = Date.now();
      if (onProgress && now - lastReported >= REPORT_EVERY_MS) {
        lastReported = now;
        onProgress({ position: positionRef.current, duration: durationRef.current });
      }
    };

    /**
     * The moments worth recording exactly.
     *
     * A phone is backgrounded rather than closed, and pagehide is the only
     * event that reliably fires then - waiting for the next timeupdate would
     * lose up to five seconds, which is the difference between resuming on
     * the line of dialogue you stopped at and resuming after it.
     */
    const report = () => {
      if (!onProgress) return;
      onProgress({ position: positionRef.current, duration: durationRef.current });
    };

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('pause', report);
    video.addEventListener('ended', report);
    window.addEventListener('pagehide', report);

    /**
     * Starts playing once the stream is attached.
     *
     * This used to run only when `wasPlaying` was true - meaning "was
     * already playing before a server switch" - so on first load nothing
     * ever called play() and the episode sat on its poster until the play
     * button was tapped. Opening an episode is itself the decision to watch
     * it; asking twice is asking once too often.
     *
     * A refusal is still swallowed. Autoplay policy varies by browser and
     * by whether the tap counted as a gesture, and an error banner over a
     * video that simply needs one more tap would be worse than the tap.
     *
     * Play is asked for here rather than by an autoPlay attribute. The
     * attribute fires whenever the element has a source, including a stale
     * one mid-teardown, which is one of the ways two soundtracks ended up
     * running at once.
     */
    const resume = () => {
      if (resumeAt > 0) video.currentTime = resumeAt;

      const played = video.play();
      if (played && typeof played.catch === 'function') played.catch(() => {});
    };

    /**
     * A server that cannot play.
     *
     * Before playback has begun there is nothing to lose, so the next
     * untried server is used automatically. Afterwards the user decides:
     * a failure mid-episode is often transient, and switching would discard
     * their position to fix something that may right itself.
     */
    const failed = (reason) => {
      if (onServerFailed) onServerFailed(current, reason);
      setDeadServers((dead) => (dead.includes(current.id) ? dead : [...dead, current.id]));

      if (startedRef.current) {
        setError(reason);
        return;
      }

      const { visible: servers, selected: index, dead } = switchingRef.current;
      const nextIndex = servers.findIndex((option, position) => (
        position !== index && option.id !== current.id && !dead.includes(option.id)
      ));

      if (nextIndex === -1) {
        setError(`${reason} No other server worked either.`);
        // Every server this home gave has failed. The screen may know of
        // another home for the same episode; if it finds one it hands back
        // new streams, and the effect above clears this error on the way in.
        if (onExhausted) onExhausted(reason);
        return;
      }

      setAutoSwitched({ from: current.server, to: servers[nextIndex].server });
      setSelected(nextIndex);
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
      video.addEventListener(
        'error',
        () => failed(describeMediaError(video.error, current.url)),
        { once: true }
      );
    }

    /**
     * Silences and detaches the old stream before the next one attaches.
     *
     * Destroying the hls instance was not enough: on the native path the
     * element keeps its own src, and an element that still holds a loaded
     * source goes on decoding it. Switching server or episode therefore
     * left the previous audio running underneath the new one - two sounds,
     * one of them from a video no longer on screen.
     *
     * pause, then drop the source, then load(): removing the attribute
     * alone does not stop a media element that has already buffered, and
     * load() is what resets it.
     */
    return () => {
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('pause', report);
      video.removeEventListener('ended', report);
      window.removeEventListener('pagehide', report);
      report();

      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      video.pause();
      video.removeAttribute('src');
      // Some engines only release the buffer when the empty source is loaded.
      video.load();
    };
    // Keyed on the stream alone. Anything else here reloads the video every
    // time a piece of unrelated state changes.
  }, [current, onServerFailed, onExhausted, onProgress]);

  /**
   * A new episode starts where it says, not where the last one stopped.
   *
   * Reset while rendering rather than in an effect. Effects run in the order
   * they are declared, and the effect that attaches the stream is declared
   * first - so it had already read the previous episode's position and
   * queued a seek to it before a reset effect could run. Episode 2 opened
   * seven minutes in.
   *
   * Doing it here means the value is correct before any effect looks at it,
   * which is the only ordering that cannot drift.
   */
  const playingRef = useRef(mediaKey);
  if (playingRef.current !== mediaKey) {
    playingRef.current = mediaKey;
    positionRef.current = startAt || 0;
    durationRef.current = 0;
  }

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
      // Content the source already downloaded for us needs no request, and
      // making one against it is how a track in memory reported a 404.
      let vtt;
      if (track.content) {
        vtt = toVtt(track.content);
      } else {
        const response = await fetch(
          subtitleUrl(track.url, current && current.headers && current.headers.Referer)
        );
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || `Subtitles could not be loaded (${response.status}).`);
        }
        vtt = await response.text();
      }

      const blob = new Blob([vtt], { type: 'text/vtt' });
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

  // Turns subtitles on without being asked, once per server. Does not run
  // for a user who has turned CC off - that choice outlives a server switch.
  useEffect(() => {
    if (ccChosen.current && !ccOn) return;
    const index = preferredSubtitleIndex(subtitles);
    if (index === -1) return;

    setSubtitleIndex(index);
    setCcOn(true);
    loadSubtitle(index);
    // Keyed on the track list alone. ccOn is read but deliberately not a
    // dependency: including it would re-enable subtitles the moment a
    // failed track switched them off, and again on every toggle.
  }, [subtitles, loadSubtitle]);

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
    ccChosen.current = true;
    if (ccOn) {
      setCcOn(false);
      return;
    }
    const index = Math.max(preferredSubtitleIndex(subtitles), 0);
    setSubtitleIndex(index);
    setCcOn(true);
    if (!tracks.some((entry) => entry.index === index)) loadSubtitle(index);
  };

  const chooseSubtitle = (index) => {
    ccChosen.current = true;
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
              key={`${track.index}:${track.label}`}
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
                  <option key={`${index}:${track.label}`} value={index}>{track.label}</option>
                ))}
              </select>
            </label>
          )}

          {qualities.length > 1 && (
            <label className="player-select">
              Quality
              <select
                value={currentQuality || ''}
                onChange={(e) => choose(e.target.value, currentServer, 'quality')}
              >
                {qualities.map((quality) => (
                  <option key={quality} value={quality}>{quality}</option>
                ))}
              </select>
            </label>
          )}

          {servers.length > 1 && (
            <label className="player-select">
              Server
              <select
                value={currentServer || ''}
                onChange={(e) => choose(currentQuality, e.target.value, 'server')}
              >
                {servers.map((server) => (
                  <option key={server} value={server}>
                    {server}
                    {visible
                      .filter((_, index) => serverKeys[index] === server)
                      .every((option) => deadServers.includes(option.id)) ? ' (failed)' : ''}
                  </option>
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
        </div>
      </div>

      {autoSwitched && !error && (
        <p className="player-notice">
          {autoSwitched.from} did not play — switched to {autoSwitched.to}.
        </p>
      )}

      {subtitleError && <p className="player-error">{subtitleError}</p>}
      {error && (
        <div className="player-error">
          <p>{error}</p>
          {visible.filter((option) => !deadServers.includes(option.id)).length > 0 && (
            <p className="player-error-hint">
              Try another server — {visible.filter((o) => !deadServers.includes(o.id)).length}{' '}
              still untried.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
