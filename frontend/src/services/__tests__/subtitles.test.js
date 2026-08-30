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

  it('says so plainly when the format cannot be shown', () => {
    expect(() => toVtt('[Script Info]\nScriptType: v4.00+\n')).toThrow(/ASS\/SSA/);
  });

  it('says so plainly when there are no cues at all', () => {
    expect(() => toVtt('<html><body>404</body></html>')).toThrow(/no cue timings/);
  });
});
