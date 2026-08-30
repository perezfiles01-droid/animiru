/**
 * Subtitle text a source handed over directly.
 *
 * Most sources give a URL for each subtitle track, which the backend proxy
 * fetches and converts - see backend/extensions/subtitles.js for why it
 * cannot be linked straight into a <track>.
 *
 * Some do not. AniKoto downloads its own subtitles (the host 403s without a
 * Referer only the source knows) and returns the file contents in the same
 * `file` field a URL would use. Treating that as a URL is how the player
 * ended up reporting "The subtitle host responded 404" and "That file does
 * not look like a subtitle" for tracks that were sitting in memory, already
 * downloaded.
 *
 * Nothing here talks to the network. The text is already in hand.
 */

/** Formats a <track> cannot render, whatever we did to them. */
const UNSUPPORTED = /^\s*(\[Script Info\]|\[V4\+? Styles\])/i;

/**
 * Whether a track's `file` is subtitle content rather than a link to it.
 *
 * A URL is one line and starts with a scheme or a slash; a subtitle file has
 * cue timings, and usually a WEBVTT header.
 */
export function isInlineSubtitle(value) {
  const text = String(value || '');
  if (!text) return false;
  if (/^\s*WEBVTT/i.test(text)) return true;
  if (text.includes('-->')) return true;
  // Anything else spanning lines is not a URL, whatever else it is.
  return /\n/.test(text.trim()) && !/^\s*(https?:)?\/\//i.test(text);
}

/**
 * SubRip to WebVTT, and WebVTT through unchanged.
 *
 * Kept deliberately in step with srtToVtt in backend/extensions/subtitles.js:
 * VTT needs its header, a dot rather than a comma for fractional seconds, and
 * has no cue numbers.
 *
 * @throws {Error} when the text is not a subtitle we can show
 */
export function toVtt(text) {
  const raw = String(text || '').replace(/^﻿/, '').replace(/\r\n/g, '\n').trim();

  if (UNSUPPORTED.test(raw)) {
    throw new Error(
      'These subtitles are in ASS/SSA format, which a browser cannot display. ' +
      'Try another server, or another subtitle track.'
    );
  }
  if (!raw.includes('-->')) {
    throw new Error('That subtitle track has no cue timings, so there is nothing to show.');
  }

  if (/^WEBVTT/i.test(raw)) return `${raw}\n`;

  const body = raw
    .split('\n')
    .map((line) => {
      if (line.includes('-->')) return line.replace(/,(\d{3})/g, '.$1');
      // A line that is only a number is a SubRip cue index; VTT has none,
      // and some players render it as dialogue.
      if (/^\d+$/.test(line.trim())) return null;
      return line;
    })
    .filter((line) => line !== null)
    .join('\n')
    .trim();

  return `WEBVTT\n\n${body}\n`;
}
