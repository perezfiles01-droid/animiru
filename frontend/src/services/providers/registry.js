/**
 * Every provider the app can currently use.
 *
 * Pages ask here rather than importing a provider directly, so that adding a
 * source is installing an extension rather than editing a page. Jellyfin
 * stays a built-in because it is configured, not installed.
 */

import jellyfin from './jellyfin';
import { createExtensionProvider } from './extension';
import { getEnabledSources } from '../extensions/storage';

/** Providers built into the app, in the order they should be offered. */
const BUILT_IN = [jellyfin];

/**
 * @returns {Object[]} configured built-ins plus every enabled extension
 */
export function getProviders() {
  const builtIn = BUILT_IN.filter((provider) => provider.isConfigured());
  const extensions = getEnabledSources().map(createExtensionProvider);
  return [...builtIn, ...extensions];
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
