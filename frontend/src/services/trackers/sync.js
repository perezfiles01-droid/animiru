import * as anilist from './anilist';
import { resolveMatch } from '../metadata';

/**
 * Sends an episode's progress to whichever trackers are connected.
 *
 * Silent by design. This runs while the user is watching, and a tracker
 * that interrupts playback to report a failure is worse than one that
 * quietly misses an episode - the next episode will carry the progress
 * anyway, since AniList stores a high-water mark rather than a count.
 */
export async function syncEpisodeProgress({ providerId, itemId, title, episodeNumber }) {
  if (!anilist.isConnected() || !anilist.isAutoSyncEnabled()) return null;

  const number = Number(episodeNumber);
  if (!Number.isFinite(number) || number <= 0) return null;

  try {
    // The same match the metadata screens use, including any correction the
    // user made - so a title they fixed once stays fixed for tracking too.
    const { match } = await resolveMatch({ providerId, itemId, title });
    if (!match) return null;

    return await anilist.setProgress(match.id, number);
  } catch (err) {
    return null;
  }
}
