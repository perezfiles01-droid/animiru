import React from 'react';
import { Link } from 'react-router-dom';
import '../styles/Settings.css';

/**
 * The frame every settings screen shares: a way back, a title, and a line
 * saying what the screen is for.
 *
 * The back link is not decoration. The bottom bar's Settings tab returns to
 * the index, so without this there is no way up from a sub-screen other
 * than the system back gesture, which is not visible and not available on
 * the web.
 */
export default function SettingsScreen({ title, summary, children }) {
  return (
    <div className="settings-page settings-screen">
      <Link to="/settings" className="settings-back">
        <span aria-hidden="true">‹</span> Settings
      </Link>

      <h1>{title}</h1>
      {summary && <p className="settings-help">{summary}</p>}

      {children}
    </div>
  );
}
