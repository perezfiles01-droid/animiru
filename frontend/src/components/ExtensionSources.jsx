import React, { useState, useEffect, useCallback, useMemo } from 'react';
import VideoPlayer from './VideoPlayer';
import { getPlaybackProviders } from '../services/providers/registry';
import '../styles/Extensions.css';

/**
 * Plays an AniList title from an installed extension.
 *
 * A source has no idea what an AniList id is, so the title is matched
 * against the source's own catalogue first. That match is a guess and is
 * sometimes wrong, so it is shown rather than applied silently and the user
 * can pick a different candidate.
 *
 * Note on headers: a source may say a video host requires a Referer. The
 * browser will not let us set one - it is a forbidden header - so a host
 * that enforces it will refuse to play here even though the source found
 * the URL correctly. Proxying playback through the backend is what would
 * fix that, and it is not in this change.
 */
export default function ExtensionSources({ titles, poster }) {
  const [providers] = useState(() => getPlaybackProviders());
  const [providerId, setProviderId] = useState(null);
  const [match, setMatch] = useState(null);
  const [picking, setPicking] = useState(false);
  const [episodes, setEpisodes] = useState([]);
  const [episode, setEpisode] = useState(null);
  const [streams, setStreams] = useState(null);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  const provider = providers.find((candidate) => candidate.id === providerId) || null;

  // Callers pass an array literal, which is a new value on every render. The
  // match effect depends on it, so without collapsing it to a stable value
  // first the effect re-runs forever and hammers the source.
  const titleKey = (titles || []).filter(Boolean).join('|');
  const names = useMemo(() => titleKey.split('|').filter(Boolean), [titleKey]);

  /** Clears everything downstream of a provider choice. */
  const reset = useCallback(() => {
    setMatch(null);
    setPicking(false);
    setEpisodes([]);
    setEpisode(null);
    setStreams(null);
    setError(null);
  }, []);

  /** Loads a source's episode list for a catalogue entry. */
  const loadEpisodes = useCallback(async (chosen, item) => {
    setStatus('Loading episodes...');
    setError(null);
    setEpisodes([]);
    setEpisode(null);
    setStreams(null);

    try {
      setEpisodes(await chosen.getEpisodes(item.id));
    } catch (err) {
      setError(err.message);
    } finally {
      setStatus(null);
    }
  }, []);

  // Choosing a source starts the match, which is the slow part, so it runs
  // as its own effect rather than blocking the click.
  useEffect(() => {
    if (!provider) return undefined;

    let cancelled = false;

    const run = async () => {
      setStatus(`Looking for this title on ${provider.name}...`);
      setError(null);

      try {
        const found = await provider.resolveByTitle(names);
        if (cancelled) return;

        setMatch(found);
        setStatus(null);

        if (found.best) {
          await loadEpisodes(provider, found.best);
        } else {
          setError(`${provider.name} has nothing matching this title.`);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setStatus(null);
        }
      }
    };

    run();
    return () => { cancelled = true; };
  }, [provider, names, loadEpisodes]);

  const handleProvider = (id) => {
    reset();
    setProviderId(id === providerId ? null : id);
  };

  const handleCandidate = async (candidate) => {
    setPicking(false);
    setMatch((current) => ({ ...current, best: candidate, confident: true }));
    await loadEpisodes(provider, candidate);
  };

  const handleEpisode = async (chosen) => {
    setEpisode(chosen);
    setStreams(null);
    setStatus('Finding video...');
    setError(null);

    try {
      const found = await provider.getStreams(chosen);
      if (found.options.length === 0) {
        setError('This source found no video for that episode.');
      } else {
        setStreams(found);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setStatus(null);
    }
  };

  if (providers.length === 0) {
    return (
      <div className="ext-sources">
        <h3>Installed sources</h3>
        <p className="extensions-empty">
          No sources installed. Add an extension repository in Settings to play
          from one here.
        </p>
      </div>
    );
  }

  return (
    <div className="ext-sources">
      <h3>Installed sources</h3>

      <div className="ext-source-tabs">
        {providers.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            className={`ext-source-tab ${candidate.id === providerId ? 'active' : ''}`}
            onClick={() => handleProvider(candidate.id)}
          >
            {candidate.name}
          </button>
        ))}
      </div>

      {status && <p className="extensions-status">{status}</p>}
      {error && <p className="extensions-error">{error}</p>}

      {match && match.best && (
        <div className="ext-match">
          <span>
            Matched <strong>{match.best.title}</strong>
            {!match.confident && (
              <span className="ext-match-warn"> — not a close match, check this</span>
            )}
          </span>
          {match.ranked.length > 1 && (
            <button
              type="button"
              className="btn btn-link"
              onClick={() => setPicking((open) => !open)}
            >
              {picking ? 'Cancel' : 'Wrong title?'}
            </button>
          )}
        </div>
      )}

      {picking && (
        <ul className="ext-candidates">
          {match.ranked.map(({ candidate, score }) => (
            <li key={candidate.id}>
              <button type="button" onClick={() => handleCandidate(candidate)}>
                {candidate.title}
                <span className="ext-candidate-score">{Math.round(score * 100)}%</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {streams && (
        <VideoPlayer
          streams={streams}
          title={episode ? episode.title : ''}
          poster={poster}
        />
      )}

      {episodes.length > 0 && (
        <div className="ext-episodes">
          {episodes.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`ext-episode ${episode && episode.id === item.id ? 'active' : ''}`}
              onClick={() => handleEpisode(item)}
            >
              {item.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
