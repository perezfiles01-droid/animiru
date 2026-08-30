import React from 'react';
import { Link } from 'react-router-dom';
import '../styles/Pages.css';

/** 521 seconds is not a position anyone reads. 8:41 is. */
export function formatPosition(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const parts = [Math.floor(total / 60) % 60, total % 60];

  if (total >= 3600) parts.unshift(Math.floor(total / 3600));

  return parts
    .map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, '0')))
    .join(':');
}

/**
 * The choice offered when a title has been watched before.
 *
 * Not a silent resume: someone opening a show they half-watched a month ago
 * may well want to start it again, and a player that decides for them is
 * the thing that makes people scrub backwards. Both options are named, with
 * the episode and the position spelled out, so neither is a guess.
 *
 * Shown as a panel rather than a modal - there is nothing to dismiss, and
 * the first episode remains one tap away underneath.
 */
export default function ContinueWatching({ entry, episodes, watchHref, onDismiss }) {
  if (!entry || !episodes || episodes.length === 0) return null;

  // The entry may have come from another extension, where the episode ids
  // mean nothing. The number is the only thing both sources agree on.
  const episode = episodes.find((candidate) => candidate.id === entry.episodeId)
    || episodes.find((candidate) => candidate.number === entry.episodeNumber);

  if (!episode) return null;

  const sameSource = episode.id === entry.episodeId;
  const resumeAt = sameSource && !entry.finished ? Number(entry.position) || 0 : 0;

  return (
    <div className="continue-watching">
      <p className="continue-watching-title">
        You were watching {episode.title}
        {resumeAt > 0 && <span className="continue-watching-at"> — {formatPosition(resumeAt)}</span>}
      </p>

      {/* A number matched from another extension is not necessarily the same
          episode, so it is not passed off as a resumed position. */}
      {!sameSource && (
        <p className="continue-watching-note">
          Watched on {entry.providerName || 'another source'}, matched by episode number.
        </p>
      )}

      <div className="continue-watching-actions">
        <Link to={`${watchHref(episode)}&t=${Math.floor(resumeAt)}`} className="btn btn-primary">
          {resumeAt > 0 ? `Continue ${episode.title}` : `Watch ${episode.title}`}
        </Link>

        {/* t=0 is deliberate and explicit: without it the player would find
            the same history entry and quietly resume anyway. */}
        <Link to={`${watchHref(episodes[0])}&t=0`} className="btn btn-secondary">
          Start from the beginning
        </Link>
      </div>

      {onDismiss && (
        <button type="button" className="btn btn-link" onClick={onDismiss}>
          Show all episodes
        </button>
      )}
    </div>
  );
}
