/**
 * Every provider the app can currently use.
 *
 * Pages ask here rather than importing a provider directly, so that adding a
 * source is installing an extension rather than editing a page. There are no
 * built-ins left: everything the app can play is something the user
 * installed.
 */

import { createExtensionProvider } from './extension';
import { getEnabledSources } from '../extensions/storage';

/**
 * @returns {Object[]} every enabled extension, in install order
 */
export function getProviders() {
  return getEnabledSources().map(createExtensionProvider);
}

export function getProvider(id) {
  return getProviders().find((provider) => provider.id === id) || null;
}

/** Providers that can supply video, which is what the Watch page needs. */
export function getPlaybackProviders() {
  return getProviders().filter((provider) => provider.capabilities.includes('playback'));
}

/** Providers with a catalogue of their own, which is what Browse needs. */
export function getBrowsableProviders() {
  return getProviders().filter((provider) => provider.capabilities.includes('library'));
}
