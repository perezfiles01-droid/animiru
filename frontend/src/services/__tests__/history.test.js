/**
 * Remembering where you got to.
 *
 * Nothing recorded this before: the player carried a position across a
 * server switch, read from the live element, and even that did not work -
 * tearing the old source down calls load(), which resets currentTime to
 * zero before the next attach reads it. Closing the app lost your place
 * entirely and every episode started from the beginning.
 */

import {
  recordProgress, getHistory, findProgress, resumePosition, removeFromHistory,
  clearHistory, titleKey, HISTORY_STORAGE_KEY, HISTORY_LIMITS
} from '../history';

const EPISODE = {
  providerId: 'extension:repo#1',
  providerName: 'AniNeko',
  itemId: '/anime/one-piece',
  title: 'One Piece',
  poster: 'https://i.test/op.jpg',
  episodeId: '/e/12',
  episodeTitle: 'Episode 12',
  episodeNumber: 12,
  position: 521,
  duration: 1440
};

beforeEach(() => window.localStorage.clear());

describe('recording progress', () => {
  it('keeps what a history screen needs to draw a row', () => {
    recordProgress(EPISODE);

    expect(getHistory()[0]).toMatchObject({
      title: 'One Piece',
      poster: 'https://i.test/op.jpg',
      episodeTitle: 'Episode 12',
      episodeNumber: 12,
      position: 521,
      providerName: 'AniNeko'
    });
  });

  // One row per show, not per episode: twelve rows of the same anime would
  // bury the thing the screen exists to show.
  it('replaces the entry for a title rather than adding another', () => {
    recordProgress(EPISODE);
    recordProgress({ ...EPISODE, episodeId: '/e/13', episodeNumber: 13, position: 60 });

    expect(getHistory()).toHaveLength(1);
    expect(getHistory()[0]).toMatchObject({ episodeNumber: 13, position: 60 });
  });

  it('moves the thing just watched to the front', () => {
    recordProgress(EPISODE);
    recordProgress({ ...EPISODE, itemId: '/anime/bleach', title: 'Bleach' });
    recordProgress({ ...EPISODE, position: 700 });

    expect(getHistory().map((entry) => entry.title)).toEqual(['One Piece', 'Bleach']);
  });

  // An accidental tap, or a few seconds while deciding, is not watching.
  it('ignores the first few seconds', () => {
    recordProgress({ ...EPISODE, position: 3 });
    expect(getHistory()).toHaveLength(0);
  });

  it('needs a source and an id to record anything', () => {
    recordProgress({ ...EPISODE, providerId: '' });
    recordProgress({ ...EPISODE, itemId: '' });

    expect(getHistory()).toHaveLength(0);
  });

  it('marks an episode watched to the end as finished', () => {
    recordProgress({ ...EPISODE, position: 1430 });
    expect(getHistory()[0].finished).toBe(true);
  });

  it('does not call a paused episode finished', () => {
    recordProgress(EPISODE);
    expect(getHistory()[0].finished).toBe(false);
  });

  // An unbounded list grows until localStorage refuses the write - which
  // fails silently, taking the newest entry with it.
  it('keeps the list bounded, dropping the oldest', () => {
    for (let index = 0; index < HISTORY_LIMITS.MAX_ENTRIES + 20; index += 1) {
      recordProgress({ ...EPISODE, itemId: `/anime/${index}`, title: `Show ${index}` });
    }

    const entries = getHistory();
    expect(entries).toHaveLength(HISTORY_LIMITS.MAX_ENTRIES);
    expect(entries[0].title).toBe(`Show ${HISTORY_LIMITS.MAX_ENTRIES + 19}`);
  });

  it('keeps the poster and title it already knew when a later update omits them', () => {
    recordProgress(EPISODE);
    recordProgress({
      providerId: EPISODE.providerId, itemId: EPISODE.itemId,
      episodeId: '/e/13', position: 90
    });

    expect(getHistory()[0]).toMatchObject({ title: 'One Piece', poster: 'https://i.test/op.jpg' });
  });

  it('survives storage that cannot be read', () => {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, 'not json');
    expect(getHistory()).toEqual([]);
  });
});

describe('finding where a title was left', () => {
  it('finds the entry for the same source and id', () => {
    recordProgress(EPISODE);

    expect(findProgress({ providerId: EPISODE.providerId, itemId: EPISODE.itemId }))
      .toMatchObject({ episodeNumber: 12 });
  });

  it('has nothing to say about a title never watched', () => {
    expect(findProgress({ providerId: 'x', itemId: 'y', title: 'Naruto' })).toBeNull();
  });

  /**
   * Watching twelve episodes on one extension and opening the thirteenth on
   * another is not starting the show again. Matched on the title, which is
   * why it is only a fallback: an episode *number* from another source is
   * not necessarily the same episode.
   */
  describe('across extensions', () => {
    it('finds the same title watched on another source', () => {
      recordProgress(EPISODE);

      expect(findProgress({
        providerId: 'extension:repo#2', itemId: '/one-piece', title: 'One Piece'
      })).toMatchObject({ episodeNumber: 12, providerName: 'AniNeko' });
    });

    it('looks past the punctuation sources disagree about', () => {
      recordProgress({ ...EPISODE, title: 'Takt Op.' });

      expect(findProgress({ providerId: 'other', itemId: 'x', title: 'Takt op.Destiny' }))
        .toBeNull();
      expect(findProgress({ providerId: 'other', itemId: 'x', title: 'takt  op' }))
        .toMatchObject({ title: 'Takt Op.' });
    });

    // The exact entry is the one that knows which episode is which.
    it('prefers the exact source over a title match', () => {
      recordProgress({ ...EPISODE, providerId: 'extension:repo#2', episodeNumber: 3, position: 30 });
      recordProgress(EPISODE);

      expect(findProgress({
        providerId: 'extension:repo#2', itemId: EPISODE.itemId, title: 'One Piece'
      })).toMatchObject({ episodeNumber: 3 });
    });

    // Opening a title whose name is unknown must not resume whatever was
    // watched most recently - that would drop the user into another show.
    it('matches nothing when there is no title to match on', () => {
      recordProgress(EPISODE);
      expect(findProgress({ providerId: 'other', itemId: 'x' })).toBeNull();
      expect(findProgress({ providerId: 'other', itemId: 'x', title: '' })).toBeNull();
    });

    it('does not match one show to another', () => {
      recordProgress(EPISODE);
      expect(findProgress({ providerId: 'x', itemId: 'y', title: 'Bleach' })).toBeNull();
    });
  });

  it('reduces a title to what two sources can agree on', () => {
    expect(titleKey('Re:ZERO -Starting Life-')).toBe(titleKey('re zero starting life'));
  });
});

describe('where an episode should start', () => {
  const entry = () => findProgress({ providerId: EPISODE.providerId, itemId: EPISODE.itemId });

  it('resumes the episode that was left unfinished', () => {
    recordProgress(EPISODE);
    expect(resumePosition(entry(), '/e/12')).toBe(521);
  });

  // Resuming a different episode at the last position drops the user into
  // the middle of something they have not seen.
  it('starts a different episode from the beginning', () => {
    recordProgress(EPISODE);
    expect(resumePosition(entry(), '/e/13')).toBe(0);
  });

  it('starts a finished episode again rather than in its credits', () => {
    recordProgress({ ...EPISODE, position: 1430 });
    expect(resumePosition(entry(), '/e/12')).toBe(0);
  });

  it('is zero when there is nothing to resume', () => {
    expect(resumePosition(null, '/e/12')).toBe(0);
  });
});

describe('removing things', () => {
  it('forgets one title', () => {
    recordProgress(EPISODE);
    recordProgress({ ...EPISODE, itemId: '/anime/bleach', title: 'Bleach' });
    removeFromHistory(EPISODE);

    expect(getHistory().map((entry) => entry.title)).toEqual(['Bleach']);
  });

  it('forgets everything', () => {
    recordProgress(EPISODE);
    clearHistory();

    expect(getHistory()).toEqual([]);
  });
});
