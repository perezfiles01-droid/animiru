/**
 * AniLight, when the API does not answer with what it should.
 *
 * Every one of these arrived on screen as "AniLight returned no titles" with
 * nothing thrown behind it: getJson answered null for anything it could not
 * parse, and filterPage read null as an empty catalogue. A 403 body, an HTML
 * error page, a bot check and a renamed field were indistinguishable, and no
 * diagnostics existed to tell them apart - so three rounds of fixes upstream
 * could not change what the screen said.
 */

const fs = require('fs');
const path = require('path');
const { runExtension } = require('../extensions');
const http = require('../extensions/http');

const CODE = fs.readFileSync(
  path.join(__dirname, '..', '..', 'extensions', 'sources', 'anilight.js'), 'utf8'
);

const SOURCE = { baseUrl: 'https://anilight.live', apiUrl: 'https://api.anilight.live/api' };

const answering = (response) => jest.spyOn(http, 'request').mockResolvedValue({
  statusCode: 200, headers: {}, url: 'https://api.anilight.live/api/filter', body: '',
  ...response
});

const browse = () => runExtension({
  code: CODE, method: 'getPopular', args: [1], source: SOURCE
});

afterEach(() => jest.restoreAllMocks());

describe('a body that is not JSON', () => {
  it('fails rather than reporting no titles', async () => {
    answering({ body: '<!DOCTYPE html><html><body>Just a moment...</body></html>' });

    await expect(browse()).rejects.toThrow(/did not return JSON/);
  });

  // Which of the failures it was, without needing the whole body.
  it('quotes the beginning of what it did get', async () => {
    answering({ body: '<!DOCTYPE html><title>Attention Required</title>' });

    await expect(browse()).rejects.toThrow(/Attention Required/);
  });

  it('names the address it asked', async () => {
    answering({ body: 'nonsense' });

    await expect(browse()).rejects.toThrow(/api\.anilight\.live/);
  });

  it('says so plainly when the body is empty', async () => {
    answering({ body: '' });

    await expect(browse()).rejects.toThrow(/an empty body/);
  });
});

describe('a status that is not a success', () => {
  it('reports the status rather than swallowing it', async () => {
    answering({ statusCode: 403, body: 'Forbidden' });

    await expect(browse()).rejects.toThrow(/answered 403/);
  });
});

describe('JSON that is not the shape expected', () => {
  // An empty list here is indistinguishable on screen from a site with
  // nothing to show, and the two need different fixing.
  it('says the shape was wrong rather than returning nothing', async () => {
    answering({ body: JSON.stringify({ results: [], pageInfo: {} }) });

    await expect(browse()).rejects.toThrow(/did not return a media list/);
  });

  it('names the keys it actually got', async () => {
    answering({ body: JSON.stringify({ results: [], pageInfo: {} }) });

    await expect(browse()).rejects.toThrow(/results, pageInfo/);
  });
});

describe('what still works', () => {
  it('returns the titles when the API answers properly', async () => {
    answering({
      body: JSON.stringify({
        media: [{ slug: 'one-piece', title: { english: 'One Piece' }, coverImage: {} }],
        pageInfo: { hasNextPage: true }
      })
    });

    const { result } = await browse();

    expect(result.list).toHaveLength(1);
    expect(result.list[0].name).toBe('One Piece');
    expect(result.hasNextPage).toBe(true);
  });

  // A site genuinely having nothing for a query is not a failure.
  it('accepts an empty media list as an empty page', async () => {
    answering({ body: JSON.stringify({ media: [], pageInfo: { hasNextPage: false } }) });

    const { result } = await browse();
    expect(result.list).toEqual([]);
  });
});
