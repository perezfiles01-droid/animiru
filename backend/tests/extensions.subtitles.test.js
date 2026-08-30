/**
 * Subtitles, and why they go through the server at all.
 *
 * A browser will not load a cross-origin <track> without CORS headers, and
 * a subtitle host has no reason to send them - so the file fetches fine and
 * then renders nothing, silently. Everything here exists to make that work
 * and to be honest about the formats that cannot.
 */

const express = require('express');
const request = require('supertest');
const { srtToVtt, extensionOf } = require('../extensions/subtitles');
const http = require('../extensions/http');

const app = express();
app.use(express.json());
app.use('/api/extensions', require('../routes/extensions'));

const SRT = [
  '1',
  '00:00:01,000 --> 00:00:04,000',
  'The first line.',
  '',
  '2',
  '00:00:05,500 --> 00:00:08,250',
  'The second line.',
  ''
].join('\n');

function serve(body, { status = 200 } = {}) {
  return jest.spyOn(http, 'request').mockResolvedValue({
    statusCode: status, body, headers: {}, url: 'https://host.test/subs.srt'
  });
}

describe('srtToVtt', () => {
  it('adds the header a browser requires', () => {
    expect(srtToVtt(SRT).startsWith('WEBVTT\n')).toBe(true);
  });

  it('converts comma milliseconds to the dot VTT expects', () => {
    const vtt = srtToVtt(SRT);
    expect(vtt).toContain('00:00:01.000 --> 00:00:04.000');
    expect(vtt).not.toContain(',000');
  });

  it('drops the cue numbers, which VTT does not use', () => {
    const vtt = srtToVtt(SRT);
    expect(vtt.split('\n').filter((line) => line.trim() === '1')).toHaveLength(0);
  });

  it('keeps the cue text exactly', () => {
    const vtt = srtToVtt(SRT);
    expect(vtt).toContain('The first line.');
    expect(vtt).toContain('The second line.');
  });

  it('strips a byte order mark, which stops the first cue parsing', () => {
    expect(srtToVtt(`﻿${SRT}`)).not.toContain('﻿');
  });

  it('handles Windows line endings', () => {
    const vtt = srtToVtt(SRT.replace(/\n/g, '\r\n'));
    expect(vtt).toContain('00:00:01.000 --> 00:00:04.000');
  });
});

describe('extensionOf', () => {
  it.each([
    ['https://h.test/a.srt', 'srt'],
    ['https://h.test/a.vtt?token=1', 'vtt'],
    ['https://h.test/a.ass#x', 'ass'],
    ['https://h.test/subtitles', '']
  ])('%s -> %s', (url, expected) => {
    expect(extensionOf(url)).toBe(expected);
  });
});

describe('GET /api/extensions/subtitle', () => {
  afterEach(() => jest.restoreAllMocks());

  it('serves SubRip converted to VTT', async () => {
    serve(SRT);
    const res = await request(app)
      .get('/api/extensions/subtitle')
      .query({ url: 'https://host.test/subs.srt' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/vtt/);
    expect(res.text).toMatch(/^WEBVTT/);
    expect(res.text).toContain('00:00:01.000 --> 00:00:04.000');
  });

  it('passes VTT through unchanged', async () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n';
    serve(vtt);

    const res = await request(app)
      .get('/api/extensions/subtitle')
      .query({ url: 'https://host.test/subs.vtt' });

    expect(res.text).toBe(vtt);
  });

  it('trusts the content over the extension', async () => {
    // Hosts serve VTT from .srt URLs and the other way round constantly.
    serve('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n');

    const res = await request(app)
      .get('/api/extensions/subtitle')
      .query({ url: 'https://host.test/subs.srt' });

    expect(res.text).toMatch(/^WEBVTT/);
    expect(res.text).not.toContain('WEBVTT\n\nWEBVTT');
  });

  it('sends the Referer a host may require', async () => {
    const spy = serve(SRT);
    await request(app).get('/api/extensions/subtitle').query({
      url: 'https://host.test/subs.srt', referer: 'https://site.test/'
    });

    expect(spy.mock.calls[0][0].headers).toEqual({ Referer: 'https://site.test/' });
  });

  // A .ass URL used to be refused before its body was read, which made the
  // extension the reason rather than the contents - and left sources that
  // serve ASS with no subtitles at all.
  it('serves an ASS file as WebVTT rather than refusing it', async () => {
    serve([
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Dialogue: 0,0:00:12.34,0:00:15.10,Default,,0,0,0,,Hello there'
    ].join('\n'));

    const res = await request(app)
      .get('/api/extensions/subtitle')
      .query({ url: 'https://host.test/subs.ass' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('00:00:12.340 --> 00:00:15.100');
    expect(res.text).toContain('Hello there');
  });

  it('rejects a file with no cue timings at all', async () => {
    serve('<html>not found</html>');
    const res = await request(app)
      .get('/api/extensions/subtitle')
      .query({ url: 'https://host.test/subs.srt' });

    expect(res.status).toBe(415);
    expect(res.body.error).toMatch(/no cue timings/);
  });

  it('reports a host that refuses', async () => {
    serve('', { status: 403 });
    const res = await request(app)
      .get('/api/extensions/subtitle')
      .query({ url: 'https://host.test/subs.srt' });

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/responded 403/);
  });

  it('refuses a subtitle URL that is not http', async () => {
    const res = await request(app)
      .get('/api/extensions/subtitle')
      .query({ url: 'file:///etc/passwd' });

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/Unsupported protocol/);
  });

  it('requires a URL', async () => {
    const res = await request(app).get('/api/extensions/subtitle');
    expect(res.status).toBe(400);
  });

  it('is cacheable, since subtitles for an episode do not change', async () => {
    serve(SRT);
    const res = await request(app)
      .get('/api/extensions/subtitle')
      .query({ url: 'https://host.test/subs.srt' });

    expect(res.headers['cache-control']).toMatch(/max-age=/);
  });
});

/**
 * SubStation Alpha, which this used to refuse with "That file does not look
 * like a subtitle - it has no cue timings" - the message a real device saw
 * on AnimeParadise, whose tracks are ASS.
 *
 * Borrowing a subtitle from another extension was the alternative and would
 * have been worse: encodes trim recaps and ad breaks differently, so a file
 * from one release drifts against another's video. The file already in hand
 * carries the right timings for the video it came with.
 */
describe('reading SubStation Alpha subtitles', () => {
  const { assToVtt, fetchSubtitle } = require('../extensions/subtitles');
  const http = require('../extensions/http');

  const sample = [
    '[Script Info]',
    'ScriptType: v4.00+',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize',
    'Style: Default,Arial,20',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:12.34,0:00:15.10,Default,,0,0,0,,Hello there',
    'Dialogue: 0,0:00:16.00,0:00:18.50,Default,,0,0,0,,{\\an8}Positioned',
    'Dialogue: 0,0:00:20.00,0:00:22.00,Default,,0,0,0,,First\\NSecond',
    'Dialogue: 0,0:00:24.00,0:00:26.00,Default,,0,0,0,,Wait, what?',
    'Comment: 0,0:00:30.00,0:00:31.00,Default,,0,0,0,,not dialogue'
  ].join('\n');

  afterEach(() => jest.restoreAllMocks());

  it('converts the timings to milliseconds', () => {
    expect(assToVtt(sample)).toContain('00:00:12.340 --> 00:00:15.100');
  });

  // Positioning and colour have no equivalent in a <track>; the words do.
  it('keeps the dialogue and drops the styling', () => {
    const vtt = assToVtt(sample);
    expect(vtt).toContain('Positioned');
    expect(vtt).not.toMatch(/\{|an8/);
  });

  it('turns an ASS line break into a real one', () => {
    expect(assToVtt(sample)).toContain('First\nSecond');
  });

  // Text is the last field and may contain commas of its own.
  it('keeps a line of dialogue containing a comma', () => {
    expect(assToVtt(sample)).toContain('Wait, what?');
  });

  it('ignores Comment rows', () => {
    expect(assToVtt(sample)).not.toContain('not dialogue');
  });

  it('says so when there is a header but no dialogue', () => {
    expect(() => assToVtt('[Script Info]\nScriptType: v4.00+')).toThrow(/no dialogue/);
  });

  // The path a device actually takes: the proxy fetches the .ass file.
  it('serves a fetched ASS file as WebVTT', async () => {
    jest.spyOn(http, 'request').mockResolvedValue({
      statusCode: 200, headers: {}, url: 'https://api.test/stream/file/x.ass', body: sample
    });

    const { vtt, sourceFormat } = await fetchSubtitle('https://api.test/stream/file/x.ass');

    expect(vtt).toMatch(/^WEBVTT/);
    expect(vtt).toContain('Hello there');
    expect(sourceFormat).toBe('ass');
  });

  // A genuine non-subtitle must still be reported as one.
  it('still refuses something that is not a subtitle at all', async () => {
    jest.spyOn(http, 'request').mockResolvedValue({
      statusCode: 200, headers: {}, url: 'x', body: '<html><body>404</body></html>'
    });

    await expect(fetchSubtitle('https://api.test/x')).rejects.toThrow(/no cue timings/);
  });
});
