import React, { useState } from 'react';
import { saveMatch } from '../services/metadata';
import '../styles/Metadata.css';

/**
 * Says which AniList entry a screen is showing, and lets it be changed.
 *
 * A wrong match is the failure most likely to be mistaken for a bug: the
 * screen looks like it worked, and the answer is simply about a different
 * show. Naming the entry makes that visible, and offering the alternatives
 * makes it fixable rather than a dead end.
 */
export default function MetadataMatch({
  providerId, itemId, match, candidates, corrected, onChange
}) {
  const [open, setOpen] = useState(false);

  const choose = (entry) => {
    saveMatch(providerId, itemId, entry.id);
    setOpen(false);
    onChange(entry);
  };

  return (
    <div className="metadata-match">
      <p className="metadata-match-line">
        {match
          ? <>Showing results for <strong>{match.title}</strong>{corrected && ' (your choice)'}</>
          : 'No AniList entry matched this title.'}
        {candidates.length > 0 && (
          <button
            type="button"
            className="btn btn-link metadata-match-change"
            onClick={() => setOpen((was) => !was)}
          >
            {match ? 'Wrong show?' : 'Pick one'}
          </button>
        )}
      </p>

      {open && (
        <ul className="metadata-match-options">
          {candidates.map((entry) => (
            <li key={entry.id}>
              <button type="button" onClick={() => choose(entry)}>
                {entry.poster && <img src={entry.poster} alt="" />}
                <span>
                  <strong>{entry.title}</strong>
                  <small>
                    {[entry.format, entry.year].filter(Boolean).join(' · ')}
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
