import { isInlineSubtitle, toVtt } from '../subtitles';

describe('telling subtitle content from a link to it', () => {
  it.each([
    'https://cdn.test/eng.vtt',
    'https://cdn.test/subs?id=4&lang=en',
    '//cdn.test/eng.srt',
    '/subs/eng.vtt'
  ])('treats %s as a URL', (value) => {
    expect(isInlineSubtitle(value)).toBe(false);
  });

  it.each([
    ['a WebVTT file', 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n'],
    ['a SubRip file', '1\n00:00:01,000 --> 00:00:02,000\nHello\n'],
    ['a single cue', '00:00:01.000 --> 00:00:02.000\nHello']
  ])('treats %s as content', (_label, value) => {
    expect(isInlineSubtitle(value)).toBe(true);
  });

  it('is not confused by an empty track', () => {
    expect(isInlineSubtitle('')).toBe(false);
    expect(isInlineSubtitle(undefined)).toBe(false);
  });
});

describe('converting subtitle content for a browser', () => {
  it('converts SubRip, dropping cue numbers and fixing the separator', () => {
    const vtt = toVtt('1\n00:00:01,500 --> 00:00:04,000\nHello there\n\n2\n00:00:05,000 --> 00:00:06,000\nBye\n');
    expect(vtt).toBe('WEBVTT\n\n00:00:01.500 --> 00:00:04.000\nHello there\n\n00:00:05.000 --> 00:00:06.000\nBye\n');
  });

  it('leaves WebVTT alone', () => {
    expect(toVtt('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi'))
      .toBe('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n');
  });

  it('strips a byte order mark, which stops the first cue parsing', () => {
    expect(toVtt('﻿WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi')).toMatch(/^WEBVTT/);
  });

  // ASS used to be refused outright, which left whole sources with no
  // subtitles at all. It carries timings and text like any other format.
  it('says so when an ASS file has a header but no dialogue', () => {
    expect(() => toVtt('[Script Info]\nScriptType: v4.00+\n')).toThrow(/no dialogue/);
  });

  it('says so plainly when there are no cues at all', () => {
    expect(() => toVtt('<html><body>404</body></html>')).toThrow(/no cue timings/);
  });
});

/**
 * SubStation Alpha, which several sources serve and which used to be
 * refused outright - leaving those sources with no subtitles at all.
 *
 * Borrowing a file from another extension was the alternative and would
 * have been worse: different encodes trim recaps and ad breaks, so a
 * subtitle from one release drifts against another's video. Every ASS file
 * already carries the timings for the video it came with.
 */
describe('reading SubStation Alpha subtitles', () => {
  const { assToVtt } = require('../subtitles');

  const sample = [
    '[Script Info]',
    'ScriptType: v4.00+',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize',
    'Style: Default,Arial,20',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:12.34,0:00:15.10,Default,,0,0,0,,Hello there',
    'Dialogue: 0,0:00:16.00,0:00:18.50,Default,,0,0,0,,{\\an8}Positioned line',
    'Dialogue: 0,0:00:20.00,0:00:22.00,Default,,0,0,0,,First\\NSecond',
    'Dialogue: 0,0:00:24.00,0:00:26.00,Default,,0,0,0,,Wait, what?',
    'Comment: 0,0:00:30.00,0:00:31.00,Default,,0,0,0,,not dialogue'
  ].join('\n');

  it('produces a WebVTT file', () => {
    expect(assToVtt(sample)).toMatch(/^WEBVTT\n\n/);
  });

  it('converts centiseconds to the milliseconds VTT wants', () => {
    expect(assToVtt(sample)).toContain('00:00:12.340 --> 00:00:15.100');
  });

  // Positioning and colour cannot be rendered by a <track> however they are
  // delivered; the dialogue can.
  it('drops the styling overrides and keeps the words', () => {
    const vtt = assToVtt(sample);
    expect(vtt).toContain('Positioned line');
    expect(vtt).not.toContain('an8');
    expect(vtt).not.toContain('{');
  });

  it('turns an ASS line break into a real one', () => {
    expect(assToVtt(sample)).toContain('First\nSecond');
  });

  // The Text field is last and may contain commas; splitting on every comma
  // truncates any line of dialogue with one in it.
  it('keeps a line of dialogue containing a comma', () => {
    expect(assToVtt(sample)).toContain('Wait, what?');
  });

  it('ignores Comment rows, which are not dialogue', () => {
    expect(assToVtt(sample)).not.toContain('not dialogue');
  });

  it('is reached through toVtt, as any other format is', () => {
    expect(toVtt(sample)).toContain('00:00:12.340 --> 00:00:15.100');
  });

  // Some files carry no Events Format line at all.
  it('falls back to the standard column layout when none is declared', () => {
    const bare = 'Dialogue: 0,0:01:00.00,0:01:02.00,Default,,0,0,0,,Bare line';
    expect(assToVtt(bare)).toContain('00:01:00.000 --> 00:01:02.000');
    expect(assToVtt(bare)).toContain('Bare line');
  });

  it('recognises ASS content as a subtitle rather than a URL', () => {
    expect(isInlineSubtitle(sample)).toBe(true);
  });
});
