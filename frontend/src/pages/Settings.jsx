import React from 'react';
import ExtensionManager from '../components/ExtensionManager';
import '../styles/Pages.css';

/**
 * Where sources come from.
 *
 * Everything the app can play comes from an installed extension, so this is
 * the one screen that decides what the app can show. Nothing here is sent to
 * a server: the repositories you add and the sources you install are
 * recorded on this device.
 */
export default function Settings() {
  return (
    <div className="settings-page">
      <h1>Settings</h1>

      <section className="settings-section">
        <h2>Extensions</h2>
        <ExtensionManager />
      </section>
    </div>
  );
}
