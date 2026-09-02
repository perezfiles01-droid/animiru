import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { syncEpisodeProgress } from '../services/trackers/sync';
import { findProgress, recordProgress, resumePosition } from '../services/history';
import EpisodeList from '../components/EpisodeList';
import SourceSwitcher from '../components/SourceSwitcher';
import VideoPlayer from '../components/VideoPlayer';
import { getProvider } from '../services/providers/registry';
import ExtensionErrorReport from '../components/ExtensionError';
import '../styles/Pages.css';

/**
 * Plays one episode from the source it came from.
 *
 * Two calls, deliberately separate: the episode list so you can move between
 * episodes without going back, and the video for the one you are watching.
 * Resolving a video is the slow part - a source usually has to load the
 * episode page and then an embedded host - so the list appears first and
 * playback follows.
 */
export default function Watch() {
  const [searchParams, setSearchParams] = useSearchParams();
  const sourceId = searchParams.get('source');
  const itemId = searchParams.get('id');
  const episodeId = searchParams.get('ep');

  const provider = useMemo(() => getProvider(sourceId), [sourceId]);

  const [episodes, setEpisodes] = useState([]);
  const [streams, setStreams] = useState(null);
  /**
   * Homes whose streams would not play, for this episode.
   *
   * Reset whenever the episode changes: a home that could not serve one
   * episode may well serve the next, and carrying the grudge across would
   * narrow the choices for no reason.
   */
  const [deadHomes, setDeadHomes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const episode = episodes.find((candidate) => candidate.id === episodeId) || null;

  /**
   * The name of the show, carried in the URL from the detail page.
   *
   * It was never being passed, so this screen showed only "Episode 1" and
   * the source's name - which is not enough to tell what you are watching.
   * Worse, the same value is what tracking matches against on AniList, so
   * with it empty every progress update searched for an empty title,
   * matched nothing, and silently did nothing at all.
   */
  const showTitle = searchParams.get('title') || '';


  useEffect(() => {
    if (!provider || !itemId) return undefined;

    let cancelled = false;
    provider.getEpisodes(itemId)
      .then((list) => { if (!cancelled) setEpisodes(list); })
      // The list is a convenience; failing to load it must not stop the
      // episode the user actually asked for from playing.
      .catch(() => {});

    return () => { cancelled = true; };
  }, [provider, itemId]);

  useEffect(() => {
    if (!provider || !episodeId) {
      setError(
        provider
          ? 'No episode was specified.'
          : 'That source is not installed any more.'
      );
      setLoading(false);
      return undefined;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      setStreams(null);
      setDeadHomes([]);

      try {
        // A source with nothing to play now throws, carrying the trace of
        // the requests it made - so the same report that explains a crash
        // explains an empty result too.
        const found = await provider.getStreams(episodeId);
        if (cancelled) return;

        setStreams(found);
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [provider, episodeId]);

  /**
   * Every server this home gave has failed to play.
   *
   * The player has already tried each one - that is what "no other server
   * worked either" means. Asking the same home again would return the same
   * unplayable list, so it is ruled out and the source is asked for the
   * episode again on whichever of its other homes can serve it.
   *
   * When there is no other home the run says so, and the error stands: the
   * player's message is then the whole truth rather than the first half of
   * it.
   */
  const handleExhausted = useCallback(async () => {
    const spent = streams && streams.home;
    if (!provider || !episodeId || !spent || deadHomes.includes(spent)) return;

    const ruledOut = [...deadHomes, spent];
    setDeadHomes(ruledOut);
    setLoading(true);

    try {
      const found = await provider.getStreams(episodeId, { excludeBaseUrls: ruledOut });
      setStreams(found);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [provider, episodeId, streams, deadHomes]);

  /**
   * Records progress once the episode is known and its video has loaded.
   *
   * Keyed on the episode rather than run on every render, so moving between
   * episodes syncs each one and re-rendering syncs none of them. Failures
   * are deliberately silent: a tracker that interrupts playback to complain
   * is worse than one that quietly misses an episode.
   */
  useEffect(() => {
    if (!episode || !streams) return;

    syncEpisodeProgress({
      providerId: sourceId,
      itemId,
      title: showTitle,
      episodeNumber: episode.number
    });
  }, [episode, streams, sourceId, itemId, searchParams]);

  const episodeTitle = episode ? episode.title : 'Episode';

  /**
   * Where this episode should start.
   *
   * Read once, when the episode is opened: after that the player owns the
   * position, and re-reading it would fight with playback. `t` in the URL
   * wins, so "Start from the beginning" can say so explicitly - without it,
   * choosing to restart would silently resume again.
   */
  const startAt = useMemo(() => {
    const asked = searchParams.get('t');
    if (asked !== null) return Number(asked) || 0;

    return resumePosition(findProgress({ providerId: sourceId, itemId }), episodeId);
  }, [sourceId, itemId, episodeId, searchParams]);

  /**
   * Records where the user has got to.
   *
   * Everything the history screen shows is captured here, because this is
   * the only place that knows all of it at once: the player knows the
   * position, and the page knows what is being played.
   */
  const remember = useCallback(({ position, duration }) => {
    if (!sourceId || !itemId) return;

    recordProgress({
      providerId: sourceId,
      providerName: provider ? provider.name : '',
      itemId,
      title: showTitle,
      poster: searchParams.get('poster') || '',
      episodeId,
      episodeTitle,
      episodeNumber: episode ? episode.number : undefined,
      position,
      duration
    });
  }, [sourceId, itemId, provider, showTitle, episodeId, episodeTitle, episode, searchParams]);


  const select = (chosen) => {
    // The title has to be carried across, or changing episode drops it -
    // taking the heading and the tracking with it.
    const next = { source: sourceId, id: itemId, ep: chosen.id };
    if (showTitle) next.title = showTitle;
    setSearchParams(next);
  };

  return (
    <div className="watch-page">
      {/* Above the player, so it is on screen whether or not the video
          loaded - which is when you most need to know what this is. */}
      {(showTitle || episodeTitle) && (
        <header className="watch-heading">
          {showTitle && <h1 className="watch-show">{showTitle}</h1>}
          <p className="watch-episode">{episodeTitle}</p>
        </header>
      )}

      {streams && (
        <VideoPlayer
          streams={streams}
          title={episodeTitle}
          mediaKey={episodeId}
          startAt={startAt}
          onProgress={remember}
          onExhausted={handleExhausted}
        />
      )}

      {loading && <div className="loader">Finding video...</div>}

      {error && (
        <div className="watch-error">
          {typeof error === 'string'
            ? <p className="extensions-error">{error}</p>
            : <ExtensionErrorReport error={error} />}
          {/* Whatever the source could not play, another one may have. The
              switcher belongs here as much as below it: this is the moment
              the user needs it, and scrolling past the error to find it is
              not obvious. */}
          <div className="watch-error-actions">
            <SourceSwitcher currentId={sourceId} title={showTitle} />
            {itemId && sourceId && (
              <Link
                to={`/anime?source=${encodeURIComponent(sourceId)}&id=${encodeURIComponent(itemId)}`}
                className="btn btn-secondary"
              >
                Back to episodes
              </Link>
            )}
          </div>
        </div>
      )}

      <div className="watch-info">
        <h2>{episodeTitle}</h2>
        {provider && (
          <p className="details-source">
            {/* A dropdown rather than a label: when a source breaks
                mid-show, moving to another one is the thing you need, and
                going back to Home to do it loses your place. */}
            <SourceSwitcher currentId={sourceId} title={showTitle} />
          </p>
        )}

        {episodes.length > 0 && (
          <EpisodeList
            episodes={episodes}
            currentId={episodeId}
            onOpen={select}
            renderEpisode={(candidate, { className, onSelect }) => (
              <button
                key={candidate.id}
                type="button"
                className={className}
                onClick={onSelect}
              >
                {candidate.title}
              </button>
            )}
          />
        )}
      </div>
    </div>
  );
}
