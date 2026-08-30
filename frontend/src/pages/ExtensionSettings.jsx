import React from 'react';
import SettingsScreen from '../components/SettingsScreen';
import ExtensionManager from '../components/ExtensionManager';

/**
 * Where sources come from.
 *
 * Everything the app can show comes from an installed extension, so this is
 * the screen that decides what the app is. Nothing here reaches a server of
 * ours: repositories and installed sources are recorded on this device.
 */
export default function ExtensionSettings() {
  return (
    <SettingsScreen
      title="Extension"
      summary={
        'Sources are installed from a repository - a URL to an index.json '
        + 'listing them. What you install is remembered on this device.'
      }
    >
      <ExtensionManager />
    </SettingsScreen>
  );
}
