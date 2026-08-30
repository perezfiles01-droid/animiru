import React, { useState } from 'react';
import { isInLibrary, toggleLibrary } from '../services/library';
import '../styles/LibraryButton.css';

/**
 * Saves a title, or takes it back out.
 *
 * The state is read once on mount rather than on every render: the only
 * thing that changes it while this is on screen is this button.
 */
export default function LibraryButton({ item }) {
  const [saved, setSaved] = useState(() => isInLibrary(item));

  const onClick = () => setSaved(toggleLibrary(item));

  return (
    <button
      type="button"
      className={`library-button ${saved ? 'saved' : ''}`}
      onClick={onClick}
      // The label says what the button *is*, not what clicking does. A
      // button reading "Add to library" that is already saved would be a
      // lie, and one reading "Remove" gives no way to see the current state.
      aria-pressed={saved}
    >
      <span className="library-button-icon" aria-hidden="true">{saved ? '♥' : '♡'}</span>
      <span className="library-button-label">{saved ? 'In library' : 'Add to library'}</span>
    </button>
  );
}
