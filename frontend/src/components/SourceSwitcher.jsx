import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getProviders } from '../services/providers/registry';
import '../styles/EpisodeList.css';

/**
 * Moves a show to a different extension without going back to Home.
 *
 * Sources break - a site moves domain, adds a bot check, or changes its
 * markup - and when that happens mid-show the useful thing is to carry on
 * somewhere else rather than start the search again.
 *
 * It lands on the other source's page for the show rather than trying to
 * open the same episode there. Sources disagree about numbering: recaps and
 * specials shift the count, so "episode 14" is not the same episode
 * everywhere, and opening the wrong one silently is worse than one more tap.
 */
export default function SourceSwitcher({ currentId, title }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const providers = getProviders();
  const others = providers.filter((provider) => provider.id !== currentId);
  const current = providers.find((provider) => provider.id === currentId);

  if (others.length === 0) return null;

  const switchTo = (provider) => {
    setOpen(false);
    navigate(`/?q=${encodeURIComponent(title || '')}&source=${encodeURIComponent(provider.id)}`);
  };

  return (
    <span className="source-switcher">
      <button
        type="button"
        className="source-switcher-toggle"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        {current ? current.name : 'Source'}
        <span aria-hidden="true"> ⇄</span>
      </button>

      {open && (
        <div className="source-switcher-menu" role="group" aria-label="Watch this on another extension">
          <p className="source-switcher-hint">
            Opens {title ? `“${title}”` : 'this title'} on another extension.
            Episode numbering can differ between sources.
          </p>
          {others.map((provider) => (
            <button
              key={provider.id}
              type="button"
              className="source-switcher-option"
              onClick={() => switchTo(provider)}
            >
              {provider.name}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
