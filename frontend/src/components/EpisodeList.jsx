import React, { useMemo, useRef, useState } from 'react';
import '../styles/EpisodeList.css';

export const PER_PAGE = 20;

/**
 * The episode list, paginated and searchable.
 *
 * A show with 360 episodes rendered all of them into one grid, which is
 * both unusable and a lot of DOM on a phone. Twenty at a time, and a search
 * for the rest.
 *
 * The search is deliberately a suggestion list rather than a filter that
 * loads as you type. Typing "1" matches episodes 1, 11, 12, 21, 100 and so
 * on, and nothing is opened until one of them is chosen - so a keystroke
 * cannot start loading an episode that was only ever a prefix of the one
 * being looked for.
 */
export default function EpisodeList({ episodes, currentId, renderEpisode, onOpen }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(() => {
    // Open on the page holding what is being watched, not on page 1: with
    // 360 episodes, episode 200 is nine taps away otherwise.
    const at = episodes.findIndex((episode) => episode.id === currentId);
    return at >= 0 ? Math.floor(at / PER_PAGE) : 0;
  });

  const container = useRef(null);

  const pages = Math.max(1, Math.ceil(episodes.length / PER_PAGE));
  const safePage = Math.min(page, pages - 1);
  const visible = episodes.slice(safePage * PER_PAGE, safePage * PER_PAGE + PER_PAGE);

  /**
   * Matched across every episode, not only the page on screen - searching
   * a paginated list that only looked at the current page would be a worse
   * kind of useless than no search at all.
   */
  const suggestions = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];

    return episodes
      .filter((episode) => {
        const label = String(episode.title || '').toLowerCase();
        const number = episode.number === undefined ? '' : String(episode.number);
        return label.includes(term) || number.includes(term);
      })
      .slice(0, 30);
  }, [episodes, query]);

  const choose = (episode) => {
    setQuery('');
    // Move the page to the chosen episode, so the list reflects where you
    // now are rather than where you were looking.
    const at = episodes.findIndex((candidate) => candidate.id === episode.id);
    if (at >= 0) setPage(Math.floor(at / PER_PAGE));
    if (onOpen) onOpen(episode);
  };

  return (
    <div className="episode-list" ref={container}>
      <div className="episode-search">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search episodes..."
          aria-label="Search episodes"
          autoComplete="off"
        />
        {query && (
          <button type="button" className="btn btn-link" onClick={() => setQuery('')}>
            Clear
          </button>
        )}
      </div>

      {query.trim() && (
        <ul className="episode-suggestions" aria-label="Matching episodes">
          {suggestions.length === 0 && (
            <li className="episode-suggestion-empty">No episode matches that.</li>
          )}
          {suggestions.map((episode) => (
            <li key={episode.id}>
              {renderEpisode(episode, {
                className: 'episode-suggestion',
                onSelect: () => choose(episode)
              })}
            </li>
          ))}
        </ul>
      )}

      {!query.trim() && (
        <>
          <div className="ext-episodes">
            {visible.map((episode) => renderEpisode(episode, {
              className: `ext-episode ${episode.id === currentId ? 'active' : ''}`,
              onSelect: () => onOpen && onOpen(episode)
            }))}
          </div>

          {pages > 1 && (
            <nav className="episode-pager" aria-label="Episode pages">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setPage(safePage - 1)}
                disabled={safePage === 0}
              >
                ← Prev
              </button>

              <span className="episode-pager-count">
                Page {safePage + 1} of {pages}
              </span>

              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setPage(safePage + 1)}
                disabled={safePage >= pages - 1}
              >
                Next →
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
