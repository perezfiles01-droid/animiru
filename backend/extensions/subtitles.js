/**
 * Serving a source's subtitle file to the player.
 *
 * A browser <track> element will not load a file from another origin unless
 * that origin sends CORS headers, and subtitle files are hosted by whoever
 * hosts the video - who has no reason to send them. The file fetches fine
 * from a source, and then renders nothing, with no error the user can see.
 * So it comes through here instead.
 *
 * It is also converted. Browsers understand WebVTT and nothing else, while
 * sources commonly serve SubRip. The two are close enough that conversion is
 * a header, a comma, and dropping the cue numbers.
 *
 * ASS and SSA are converted too, though only their words survive: the
 * positioning, colours and karaoke timing they carry have no equivalent in
 * a <track>, whatever is done to them. Refusing them outright - which this
 * used to do - left several sources with no subtitles at all, and the
 * alternative of borrowing a file from another extension would drift,
 * because a different encode trims recaps and ad breaks differently.
 *
 * Historically: ASS and SSA carried positioning, styling and
 * typesetting that a <track> cannot express, and a stripped-to-text version
 * would be mistimed karaoke and stray sign translations over the dialogue.
 * Better to say the format is unsupported than to render it badly.
 */

const http = require('./http');

const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024;

/** Formats we can hand a browser, by file extension. */
const VTT = 'vtt';
const SRT = 'srt';

/** The extension of a URL, ignoring its query string. */

/** SubStation Alpha, in either of its versions. */
const ASS = /^\s*(\[Script Info\]|\[V4\+? Styles\]|\[Events\])|^\s*Dialogue:\s/im;
const ASS_FORMAT = 'ass';

/** `0:00:12.34` to `00:00:12.340`, which is what VTT wants. */
function assTimestamp(value) {
  const parts = /^(\d+):(\d{2}):(\d{2})[.,](\d{1,3})$/.exec(String(value || '').trim());
  if (!parts) return null;

  const [, hours, minutes, seconds, fraction] = parts;
  // ASS counts hundredths; VTT counts thousandths.
  return `${String(hours).padStart(2, '0')}:${minutes}:${seconds}`
    + `.${fraction.padEnd(3, '0').slice(0, 3)}`;
}

/** Drops the override blocks a <track> cannot render, keeping the words. */
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
 * Kept in step with assToVtt in frontend/src/services/subtitles.js, which
 * handles the same format arriving as inline content rather than a URL.
 *
 * The Text field is last and may contain commas of its own, so a row is
 * split on the column count the Format line declares rather than on every
 * comma - splitting naively truncates any line of dialogue containing one.
 */
function assToVtt(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');

  let fields = null;
  const cues = [];

  for (const line of lines) {
    if (/^\s*Format:/i.test(line) && fields === null) {
      const names = line.replace(/^\s*Format:\s*/i, '').split(',').map((name) => name.trim());
      // Only the Events format matters; a Styles one has no Text column.
      if (names.some((name) => /^Text$/i.test(name))) fields = names;
      continue;
    }

    if (!/^\s*Dialogue:\s*/i.test(line)) continue;

    const parts = line.replace(/^\s*Dialogue:\s*/i, '').split(',');
    const count = fields ? fields.length : 10;
    const head = parts.slice(0, count - 1);
    const body = parts.slice(count - 1).join(',');

    const start = assTimestamp(fields
      ? head[fields.findIndex((name) => /^Start$/i.test(name))]
      : head[1]);
    const end = assTimestamp(fields
      ? head[fields.findIndex((name) => /^End$/i.test(name))]
      : head[2]);
    const content = assText(body);

    if (!start || !end || !content) continue;
    cues.push(`${start} --> ${end}\n${content}`);
  }

  if (cues.length === 0) {
    throw new SubtitleError(
      'Those subtitles have no dialogue in them, so there is nothing to show.',
      415
    );
  }

  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

function extensionOf(url) {
  const path = String(url).split('?')[0].split('#')[0];
  const match = path.match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : '';
}

/**
 * SubRip to WebVTT.
 *
 * The differences that matter: VTT needs its header, uses a dot for
 * fractional seconds where SubRip uses a comma, and has no cue numbers.
 * Everything else - the cue text, the blank-line separation - carries over
 * unchanged, so the file is rewritten line by line rather than parsed.
 */
function srtToVtt(text) {
  const body = String(text)
    // A byte order mark ahead of the first timestamp stops it parsing.
    .replace(/^﻿/, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      // 00:00:01,000 --> 00:00:04,000
      if (/-->/.test(line)) return line.replace(/,(\d{3})/g, '.$1');
      // A line that is only a number is a cue index, which VTT does not use.
      // Harmless to keep, but it reads as cue text in some players.
      if (/^\d+$/.test(line.trim())) return null;
      return line;
    })
    .filter((line) => line !== null)
    .join('\n')
    .trim();

  return `WEBVTT\n\n${body}\n`;
}

class SubtitleError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'SubtitleError';
    this.status = status;
  }
}

/**
 * Fetches a subtitle and returns it as WebVTT.
 *
 * @param {string} url
 * @param {Object} [headers] what the source said the host requires
 * @returns {Promise<{vtt: string, sourceFormat: string}>}
 */
async function fetchSubtitle(url, headers) {
  // Deliberately no check on the extension here. A .ass URL used to be
  // refused before its body was even read, which made the file's format the
  // reason rather than its contents - and plenty of hosts serve one format
  // from another's extension. What can be shown is decided below, from what
  // actually arrives.

  let response;
  try {
    response = await http.request({ url, method: 'GET', headers: headers || {} });
  } catch (err) {
    throw new SubtitleError(`Could not fetch the subtitle: ${err.message}`, 502);
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new SubtitleError(`The subtitle host responded ${response.statusCode}`, 502);
  }
  if (response.body.length > MAX_SUBTITLE_BYTES) {
    throw new SubtitleError('That subtitle file is implausibly large', 413);
  }

  const body = response.body;

  // Trust the content over the extension: plenty of hosts serve VTT from a
  // .srt URL and the other way round.
  if (/^﻿?WEBVTT/.test(body)) {
    return { vtt: body.replace(/^﻿/, ''), sourceFormat: VTT };
  }

  if (/-->/.test(body)) {
    return { vtt: srtToVtt(body), sourceFormat: SRT };
  }

  // ASS carries a start, an end and a line of text on every Dialogue row,
  // which is everything a subtitle needs. It used to be refused here, which
  // left whole sources - AnimeParadise among them - with no subtitles at all
  // and an error blaming the file for having no cue timings.
  if (ASS.test(body)) {
    return { vtt: assToVtt(body), sourceFormat: ASS_FORMAT };
  }

  throw new SubtitleError(
    'That file does not look like a subtitle - it has no cue timings.',
    415
  );
}

module.exports = {
  fetchSubtitle, srtToVtt, assToVtt, extensionOf, SubtitleError, MAX_SUBTITLE_BYTES
};
