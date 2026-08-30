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

/** SubStation Alpha, in either of its versions. */
const ASS = /^\s*(\[Script Info\]|\[V4\+? Styles\]|\[Events\])|^\s*Dialogue:\s/im;

/** `0:00:12.34` - hours, minutes, seconds, centiseconds. */
const ASS_TIME = /^(\d+):(\d{2}):(\d{2})[.,](\d{1,3})$/;

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
  if (ASS.test(text)) return true;
  // Anything else spanning lines is not a URL, whatever else it is.
  return /\n/.test(text.trim()) && !/^\s*(https?:)?\/\//i.test(text);
}

/** `0:00:12.34` to `00:00:12.340`, which is what VTT wants. */
function assTimestamp(value) {
  const parts = ASS_TIME.exec(String(value || '').trim());
  if (!parts) return null;

  const [, hours, minutes, seconds, fraction] = parts;
  // ASS counts hundredths; VTT counts thousandths.
  const millis = fraction.padEnd(3, '0').slice(0, 3);

  return `${String(hours).padStart(2, '0')}:${minutes}:${seconds}.${millis}`;
}

/**
 * Strips what a <track> cannot show, leaving the words.
 *
 * Override blocks - {\\an8}, {\\pos(...)}, karaoke timings - carry the
 * styling, which a browser cannot render however it is delivered. Dropping
 * them is the whole compromise: positioning and colour are lost, the
 * dialogue is not.
 */
function assText(value) {
  return String(value || '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/\\[Nn]/g, '\n')
    .replace(/\\h/g, ' ')
    .trim();
}

/**
 * SubStation Alpha to WebVTT.
 *
 * The Text field is last and may itself contain commas, so the row is split
 * on the number of fields the Format line declares rather than on every
 * comma - splitting naively truncates any line of dialogue containing one.
 */
export function assToVtt(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');

  let fields = null;
  const cues = [];

  for (const line of lines) {
    if (/^\s*Format:/i.test(line) && fields === null) {
      const names = line.replace(/^\s*Format:\s*/i, '').split(',').map((n) => n.trim());
      // Only the Events format matters; a Styles one has no Text column.
      if (names.some((name) => /^Text$/i.test(name))) fields = names;
      continue;
    }

    if (!/^\s*Dialogue:\s*/i.test(line)) continue;

    const row = line.replace(/^\s*Dialogue:\s*/i, '');
    // Default to the standard ten-column layout when no Format line was seen.
    const count = fields ? fields.length : 10;
    const parts = row.split(',');
    const head = parts.slice(0, count - 1);
    const body = parts.slice(count - 1).join(',');

    const startAt = fields
      ? head[fields.findIndex((name) => /^Start$/i.test(name))]
      : head[1];
    const endAt = fields
      ? head[fields.findIndex((name) => /^End$/i.test(name))]
      : head[2];

    const start = assTimestamp(startAt);
    const end = assTimestamp(endAt);
    const content = assText(body);

    if (!start || !end || !content) continue;
    cues.push(`${start} --> ${end}\n${content}`);
  }

  if (cues.length === 0) {
    throw new Error('Those subtitles have no dialogue in them, so there is nothing to show.');
  }

  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
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

  // ASS carries a start, an end and a line of text on every Dialogue row -
  // everything a subtitle needs. It used to be refused outright, which left
  // whole sources with no subtitles at all; converting reaches every one of
  // them without borrowing a file from elsewhere, which would drift against
  // a different encode.
  if (ASS.test(raw)) return assToVtt(raw);

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
