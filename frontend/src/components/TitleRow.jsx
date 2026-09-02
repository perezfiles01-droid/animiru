import React from 'react';
import { Link } from 'react-router-dom';
import '../styles/Rows.css';

/**
 * One horizontal row of titles.
 *
 * A grid puts four titles on a phone screen and pushes everything after it
 * out of sight; a row puts the same four on screen and says there are more
 * by being cut off at the edge. Which is why every front page that has to
 * show several lists at once is built this way.
 *
 * Rows render nothing when empty rather than showing a heading over blank
 * space - a row that failed to load and a row with nothing in it look the
 * same to whoever is holding the phone, and neither is worth a gap.
 */
export default function TitleRow({ title, entries, hrefFor, subtitleFor, error }) {
  if (error) {
    return (
      <section className="title-row">
        <h2 className="title-row-heading">{title}</h2>
        {/* Named as AniList's failure: the catalogue below still works, and
            a bare error here would look like the app is broken. */}
        <p className="metadata-error">
          {error} This is AniList, not your sources.
        </p>
      </section>
    );
  }

  if (!entries || entries.length === 0) return null;

  return (
    <section className="title-row">
      <h2 className="title-row-heading">{title}</h2>

      <div className="title-row-strip">
        {entries.map((entry) => (
          <Link key={entry.key} to={hrefFor(entry)} className="title-row-card">
            {entry.poster
              ? (
                <img
                  src={entry.poster}
                  alt=""
                  className="title-row-poster"
                  loading="lazy"
                  /* A poster that fails to load used to be indistinguishable
                     from one that was never stored: both drew a rectangle in
                     the surface colour. That made a bug report unanswerable -
                     the screenshot could not say whether the URL was missing
                     or refused. Marking the failure makes the two different
                     things look different. */
                  onError={(event) => {
                    event.currentTarget.classList.add('title-row-poster--failed');
                  }}
                />
              )
              : <div className="title-row-poster title-row-blank" aria-hidden="true" />}

            <span className="title-row-title">{entry.title}</span>
            {subtitleFor && (
              <span className="title-row-subtitle">{subtitleFor(entry)}</span>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}
