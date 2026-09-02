/**
 * The metadata routes.
 *
 * These stand in front of AniList, so the two things worth pinning are that
 * a bad request is reported as the app's fault rather than AniList's, and
 * that the chart name cannot be passed straight through - it decides what
 * we run against a shared rate limit.
 */

const express = require('express');
const request = require('supertest');

const anilist = require('../metadata/anilist');

const app = express();
app.use(express.json());
app.use('/api/metadata', require('../routes/metadata'));

afterEach(() => jest.restoreAllMocks());

describe('GET /api/metadata/chart/:name', () => {
  it('returns the chart it was asked for', async () => {
    jest.spyOn(anilist, 'getChart').mockResolvedValue({
      results: [{ id: 1, title: 'One Piece' }]
    });

    const res = await request(app).get('/api/metadata/chart/trending');

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(anilist.getChart).toHaveBeenCalledWith('trending', { perPage: 20 });
  });

  it('passes a requested size through', async () => {
    jest.spyOn(anilist, 'getChart').mockResolvedValue({ results: [] });
    await request(app).get('/api/metadata/chart/top?perPage=5');

    expect(anilist.getChart).toHaveBeenCalledWith('top', { perPage: 5 });
  });

  // Passing the name through would let any sort be run against AniList on
  // our rate limit.
  it('refuses a chart name it does not know', async () => {
    const getChart = jest.spyOn(anilist, 'getChart');
    const res = await request(app).get('/api/metadata/chart/DROP');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown chart/);
    expect(getChart).not.toHaveBeenCalled();
  });

  // A 502 would send someone looking at AniList for a fault of ours.
  it('does not blame AniList for a bad request', async () => {
    const res = await request(app).get('/api/metadata/chart/nonsense');
    expect(res.status).not.toBe(502);
  });

  it('still reports an AniList failure as one', async () => {
    jest.spyOn(anilist, 'getChart').mockRejectedValue(new Error('AniList is rate limiting'));

    const res = await request(app).get('/api/metadata/chart/trending');

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: 'AniList is rate limiting', scope: 'metadata' });
  });
});
