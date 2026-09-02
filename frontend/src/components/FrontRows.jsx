import React, { useEffect, useState } from 'react';
import TitleRow from './TitleRow';
import { getChart, findOnSourcesHref } from '../services/metadata';
import { getHistory, resumePosition } from '../services/history';
import { formatPosition } from './ContinueWatching';

/**
 * What the front page opens with, above whichever source is selected.
 *
 * Continue watching comes from this device: those entries were recorded by
 * the player, so each card knows its source, its episode and its position
 * and goes straight back to it.
 *
 * The other three come from AniList, which knows titles and nothing about
 * your extensions - so those cards can only search your sources by name.
 * That is the honest limit of the idea: they are somewhere to start, and a
 * title none of your sources carries will say so when the search returns
 * nothing, rather than failing here.
 *
 * Each row loads independently. AniList being slow or rate limited must not
 * hold up the catalogue below, and one row failing must not empty the rest.
 */

/** The nice name for a season, for a heading that says which one it is. */
const SEASON_NAMES = {
  WINTER: 'Winter', SPRING: 'Spring', SUMMER: 'Summer', FALL: 'Fall'
};

function useChart(name) {
  const [state, setState] = useState({ results: [] });

  useEffect(() => {
    let cancelled = false;

    getChart(name).then((chart) => {
      if (!cancelled) setState(chart);
    });

    return () => { cancelled = true; };
  }, [name]);

  return state;
}

/** A heading that names the season rather than guessing at the month. */
export function seasonHeading(chart) {
  const named = SEASON_NAMES[chart.season];
  return named ? `Top this ${named}` : 'Top this season';
}

export default function FrontRows() {
  // Read once on mount: re-reading on every render would redraw the row
  // while it is being scrolled.
  const [watching] = useState(() => getHistory().slice(0, 20));

  /**
   * One call each, written out rather than mapped over a list.
   *
   * A hook inside a loop happens to work while the list is a fixed
   * constant, and breaks the moment it is not - and the lint rule that
   * catches it is not registered in this project's build, so nothing would
   * have said so.
   */
  const trending = useChart('trending');
  const season = useChart('season');
  const top = useChart('top');

  const charts = [
    { name: 'trending', title: 'Trending now', ...trending },
    { name: 'season', title: 'Top this season', ...season },
    { name: 'top', title: 'Top rated of all time', ...top }
  ];

  const continueEntries = watching.map((entry) => ({
    key: `${entry.providerId}:${entry.itemId}`,
    title: entry.title,
    poster: entry.poster,
    entry
  }));

  /** Straight back to the episode, at the position, as History does. */
  const continueHref = ({ entry }) =>
    `/watch?source=${encodeURIComponent(entry.providerId)}`
    + `&id=${encodeURIComponent(entry.itemId)}`
    + `&ep=${encodeURIComponent(entry.episodeId)}`
    + `&title=${encodeURIComponent(entry.title || '')}`
    + (entry.poster ? `&poster=${encodeURIComponent(entry.poster)}` : '')
    + `&t=${Math.floor(resumePosition(entry, entry.episodeId))}`;

  return (
    <div className="front-rows">
      <TitleRow
        title="Continue watching"
        entries={continueEntries}
        hrefFor={continueHref}
        subtitleFor={({ entry }) => (
          `${entry.episodeTitle || `Episode ${entry.episodeNumber ?? ''}`}`
          + ` — ${formatPosition(entry.position)}`
        )}
      />

      {charts.map((chart) => (
        <TitleRow
          key={chart.name}
          title={chart.name === 'season' ? seasonHeading(chart) : chart.title}
          error={chart.error}
          entries={(chart.results || []).map((entry) => ({
            key: `${chart.name}:${entry.id}`,
            title: entry.title,
            poster: entry.poster
          }))}
          // AniList has no source id, so a card is a search on your own
          // sources by name. It is the only thing that can be done with it.
          hrefFor={(entry) => findOnSourcesHref(entry.title)}
        />
      ))}
    </div>
  );
}
