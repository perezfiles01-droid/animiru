/**
 * Title matching decides which of a source's entries is the show AniList
 * named, and it is wrong often enough that the interesting cases are the
 * near misses.
 */

import { normalizeTitle, similarity, rankCandidates, CONFIDENT_MATCH } from '../titleMatch';

describe('normalizeTitle', () => {
  it('strips punctuation and case', () => {
    expect(normalizeTitle('Re:ZERO -Starting Life-')).toBe('re zero starting life');
  });

  it('reconciles the two ways a season is written', () => {
    expect(normalizeTitle('Attack on Titan 2nd Season'))
      .toBe(normalizeTitle('Attack on Titan Season 2'));
  });

  it('drops release-format noise', () => {
    expect(normalizeTitle('One Piece (TV) [Dub]')).toBe('one piece');
  });
});

describe('similarity', () => {
  it('is 1 for titles that differ only in formatting', () => {
    expect(similarity('Fullmetal Alchemist: Brotherhood', 'fullmetal alchemist brotherhood')).toBe(1);
  });

  it('is 0 when either side is empty', () => {
    expect(similarity('', 'Bleach')).toBe(0);
  });

  it('penalises a title that is missing words', () => {
    expect(similarity('Naruto', 'Naruto Shippuden')).toBeLessThan(1);
  });

  it('still rates a prefix match above an unrelated one', () => {
    expect(similarity('Naruto', 'Naruto Shippuden'))
      .toBeGreaterThan(similarity('Naruto', 'Cowboy Bebop'));
  });

  it('rates an unrelated title at zero', () => {
    expect(similarity('Bleach', 'Cowboy Bebop')).toBe(0);
  });
});

describe('rankCandidates', () => {
  const candidates = [
    { id: '1', title: 'Naruto' },
    { id: '2', title: 'Bleach: Thousand-Year Blood War' },
    { id: '3', title: 'Bleach' }
  ];

  it('returns the best match first', () => {
    const { best, ranked } = rankCandidates(['Bleach'], candidates);
    expect(best.id).toBe('3');
    expect(ranked[0].candidate.id).toBe('3');
  });

  it('tries every title AniList knows, not just the first', () => {
    // The romaji title misses; the english one is the one indexed.
    const { best, confident } = rankCandidates(
      ['Sousou no Frieren', 'Frieren'],
      [{ id: '9', title: 'Frieren' }]
    );
    expect(best.id).toBe('9');
    expect(confident).toBe(true);
  });

  it('marks a weak best match as not confident', () => {
    const { best, confident, score } = rankCandidates(['Bleach'], [
      { id: '2', title: 'Bleach: Thousand-Year Blood War' }
    ]);
    expect(best.id).toBe('2');
    expect(score).toBeLessThan(CONFIDENT_MATCH);
    expect(confident).toBe(false);
  });

  it('reports nothing when no candidate shares a word', () => {
    const { best, confident } = rankCandidates(['Bleach'], [{ id: '1', title: 'Cowboy Bebop' }]);
    expect(best).toBeNull();
    expect(confident).toBe(false);
  });

  it('handles an empty candidate list', () => {
    expect(rankCandidates(['Bleach'], [])).toMatchObject({ best: null, confident: false });
  });
});
