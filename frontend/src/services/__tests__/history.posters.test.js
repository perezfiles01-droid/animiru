/**
 * Why a history row had no picture.
 *
 * The poster reaches history from one place only: the `poster` parameter on
 * the /watch URL, which the player reads and stores. Only the details page
 * ever put it there. The two links that go back into the player - the
 * Continue watching row and the History screen - appended it only when the
 * entry already had one.
 *
 * So an entry stored without a poster could never gain one. Resuming it
 * re-recorded it with the same empty value, and the only way to heal it was
 * to navigate to the details page again, which nobody does for a show they
 * are in the middle of. Every entry recorded before the player learned to
 * carry posters was permanently blank.
 *
 * Two halves, and both are needed. Closing the hole stops new entries
 * becoming permanent; the backfill repairs the ones already stored, which
 * closing the hole does nothing for.
 */

import {
  recordProgress, getHistory, backfillPosters, HISTORY_STORAGE_KEY
} from '../history';

const entry = (over = {}) => ({
  providerId: 'src', itemId: 'show-1', title: 'Takt Op.',
  episodeId: 'ep-1', episodeTitle: 'E1', episodeNumber: 1,
  position: 90, duration: 1400, ...over
});

beforeEach(() => window.localStorage.clear());

describe('an entry stored without a poster', () => {
  it('is what the old records actually look like', () => {
    recordProgress(entry());

    expect(getHistory()[0].poster).toBe('');
  });

  it('gains one from the source it came from', async () => {
    recordProgress(entry());

    await backfillPosters({
      getProvider: () => ({ getItem: async () => ({ poster: 'https://img.test/takt.jpg' }) })
    });

    expect(getHistory()[0].poster).toBe('https://img.test/takt.jpg');
  });

  it('keeps everything else about the entry exactly as it was', async () => {
    recordProgress(entry());
    const before = getHistory()[0];

    await backfillPosters({
      getProvider: () => ({ getItem: async () => ({ poster: 'https://img.test/takt.jpg' }) })
    });

    expect(getHistory()[0]).toEqual({ ...before, poster: 'https://img.test/takt.jpg' });
  });
});

describe('what the backfill must not do', () => {
  it('does not ask about entries that already have a poster', async () => {
    recordProgress(entry({ poster: 'https://img.test/have.jpg' }));
    const getItem = jest.fn();

    await backfillPosters({ getProvider: () => ({ getItem }) });

    expect(getItem).not.toHaveBeenCalled();
  });

  it('asks once per title, not once per row', async () => {
    recordProgress(entry({ itemId: 'a' }));
    recordProgress(entry({ itemId: 'b' }));
    const getItem = jest.fn(async () => ({ poster: 'https://img.test/x.jpg' }));

    await backfillPosters({ getProvider: () => ({ getItem }) });

    expect(getItem).toHaveBeenCalledTimes(2);
  });

  // A source that is uninstalled, offline, or simply does not know is not a
  // reason to lose the row - the title and the position are still what the
  // user came back for.
  it('leaves the entry alone when the source cannot answer', async () => {
    recordProgress(entry());

    await backfillPosters({
      getProvider: () => ({ getItem: async () => { throw new Error('offline'); } })
    });

    expect(getHistory()).toHaveLength(1);
    expect(getHistory()[0].poster).toBe('');
  });

  it('survives a source that is no longer installed', async () => {
    recordProgress(entry());

    await expect(backfillPosters({ getProvider: () => null })).resolves.not.toThrow();
    expect(getHistory()).toHaveLength(1);
  });

  it('does not write anything when there is nothing to fix', async () => {
    recordProgress(entry({ poster: 'https://img.test/have.jpg' }));
    const before = window.localStorage.getItem(HISTORY_STORAGE_KEY);

    await backfillPosters({ getProvider: () => ({ getItem: async () => ({}) }) });

    expect(window.localStorage.getItem(HISTORY_STORAGE_KEY)).toBe(before);
  });
});
