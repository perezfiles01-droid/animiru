/**
 * Sending progress while the user is watching.
 *
 * Silent by design: a tracker that interrupts playback to report a failure
 * is worse than one that quietly misses an episode.
 */

import { syncEpisodeProgress } from '../sync';
import * as anilist from '../anilist';
import * as metadata from '../../metadata';

jest.mock('../anilist', () => ({
  isConnected: jest.fn(),
  isAutoSyncEnabled: jest.fn(),
  setProgress: jest.fn()
}));
jest.mock('../../metadata', () => ({ resolveMatch: jest.fn() }));

const args = { providerId: 'extension:a', itemId: '/x', title: 'Heart', episodeNumber: 4 };

describe('syncing an episode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    anilist.isConnected.mockReturnValue(true);
    anilist.isAutoSyncEnabled.mockReturnValue(true);
    metadata.resolveMatch.mockResolvedValue({ match: { id: 101 } });
    anilist.setProgress.mockResolvedValue({ progress: 4 });
  });

  it('records the episode against the matched title', async () => {
    await syncEpisodeProgress(args);
    expect(anilist.setProgress).toHaveBeenCalledWith(101, 4);
  });

  it('does nothing when no tracker is connected', async () => {
    anilist.isConnected.mockReturnValue(false);

    expect(await syncEpisodeProgress(args)).toBeNull();
    expect(anilist.setProgress).not.toHaveBeenCalled();
  });

  it('does nothing when the user turned syncing off', async () => {
    anilist.isAutoSyncEnabled.mockReturnValue(false);

    expect(await syncEpisodeProgress(args)).toBeNull();
    expect(anilist.setProgress).not.toHaveBeenCalled();
  });

  it('does nothing when the episode has no number to record', async () => {
    expect(await syncEpisodeProgress({ ...args, episodeNumber: undefined })).toBeNull();
    expect(anilist.setProgress).not.toHaveBeenCalled();
  });

  it('does nothing when the title matched nothing on AniList', async () => {
    metadata.resolveMatch.mockResolvedValue({ match: null });

    expect(await syncEpisodeProgress(args)).toBeNull();
    expect(anilist.setProgress).not.toHaveBeenCalled();
  });

  // The next episode carries the progress anyway: AniList stores a
  // high-water mark, not a count.
  it('swallows a failure rather than interrupting playback', async () => {
    anilist.setProgress.mockRejectedValue(new Error('rate limited'));

    await expect(syncEpisodeProgress(args)).resolves.toBeNull();
  });

  // A correction the user made for the metadata screens applies here too.
  it('uses the same match the metadata screens use', async () => {
    await syncEpisodeProgress(args);

    expect(metadata.resolveMatch).toHaveBeenCalledWith({
      providerId: 'extension:a', itemId: '/x', title: 'Heart'
    });
  });
});
