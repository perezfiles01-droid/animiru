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

  it('says plainly that ASS cannot be shown, rather than mangling it', async () => {
    const res = await request(app)
      .get('/api/extensions/subtitle')
      .query({ url: 'https://host.test/subs.ass' });

    expect(res.status).toBe(415);
    expect(res.body.error).toMatch(/cannot be shown in a browser/);
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
