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
 * ASS and SSA are not converted. They carry positioning, styling and
 * typesetting that a <track> cannot express, and a stripped-to-text version
 * would be mistimed karaoke and stray sign translations over the dialogue.
 * Better to say the format is unsupported than to render it badly.
 */

const http = require('./http');

const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024;

/** Formats we can hand a browser, by file extension. */
const VTT = 'vtt';
const SRT = 'srt';
const UNSUPPORTED = new Set(['ass', 'ssa']);

/** The extension of a URL, ignoring its query string. */
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
  const format = extensionOf(url);

  if (UNSUPPORTED.has(format)) {
    throw new SubtitleError(
      `${format.toUpperCase()} subtitles cannot be shown in a browser. `
      + 'They carry positioning and styling a video track cannot express.',
      415
    );
  }

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

  throw new SubtitleError(
    'That file does not look like a subtitle - it has no cue timings.',
    415
  );
}

module.exports = { fetchSubtitle, srtToVtt, extensionOf, SubtitleError, MAX_SUBTITLE_BYTES };
