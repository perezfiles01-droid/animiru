import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as anilist from '../services/trackers/anilist';
import '../styles/Pages.css';

/**
 * Connecting a tracking service.
 *
 * Only AniList for now, and the screen says so rather than listing four
 * more that would do nothing when tapped. Each service needs its own
 * registered developer application, so they arrive one at a time.
 */
export default function TrackingSettings() {
  const [clientId, setClientId] = useState(() => anilist.getClientId());
  const [user, setUser] = useState(() => anilist.getUser());
  const [autoSync, setAutoSync] = useState(() => anilist.isAutoSyncEnabled());
  const [token, setToken] = useState('');
  const [status, setStatus] = useState(null);

  const submit = (value) => {
    setStatus({ kind: 'working', message: 'Confirming with AniList...' });

    anilist.connect(value)
      .then((viewer) => {
        setUser(viewer);
        setToken('');
        setStatus({ kind: 'ok', message: `Connected as ${viewer.name}.` });
      })
      .catch((err) => setStatus({ kind: 'error', message: err.message }));
  };

  /**
   * On the web, AniList can send the token back in the URL fragment, so it
   * is read once and stripped from the address bar - a token sitting in a
   * URL is one shared link away from somewhere it should not be. In the
   * Android app the redirect cannot come back to us at all, which is what
   * the pasted token below is for.
   */
  useEffect(() => {
    const fromUrl = anilist.tokenFromFragment(window.location.hash);
    if (!fromUrl) return;

    window.history.replaceState(null, '', window.location.pathname);
    submit(fromUrl);
  }, []);

  const saveClientId = (value) => {
    setClientId(value);
    anilist.setClientId(value);
  };

  const toggleAutoSync = () => {
    const next = !autoSync;
    setAutoSync(next);
    anilist.setAutoSyncEnabled(next);
  };

  const disconnect = () => {
    anilist.disconnect();
    setUser(null);
    setStatus({ kind: 'ok', message: 'Disconnected.' });
  };

  return (
    <div className="settings-page">
      <header className="settings-header">
        <Link to="/settings" className="metadata-back" aria-label="Back">←</Link>
        <h1>Tracking</h1>
      </header>

      <section className="settings-section">
        <label className="settings-toggle">
          <span>Update progress after watching</span>
          <input
            type="checkbox"
            checked={autoSync}
            onChange={toggleAutoSync}
            disabled={!user}
          />
        </label>
        <p className="settings-hint">
          One-way: Animiru updates your AniList progress as you watch. It
          never changes what you watch here based on your list.
        </p>
      </section>

      <section className="settings-section">
        <h2>AniList</h2>

        {user ? (
          <div className="tracker-connected">
            {user.avatar && <img src={user.avatar} alt="" className="tracker-avatar" />}
            <p>Connected as <strong>{user.name}</strong></p>
            <button type="button" className="btn btn-secondary" onClick={disconnect}>
              Disconnect
            </button>
          </div>
        ) : (
          <>
            <p className="settings-hint">
              AniList needs an application of your own - there is no shared
              Animiru one, and a shared one would make everyone's tracking
              depend on a single registration.
            </p>
            <ol className="settings-steps">
              <li>
                Open <a href="https://anilist.co/settings/developer" target="_blank" rel="noreferrer">
                  anilist.co/settings/developer
                </a> and create a client.
              </li>
              <li>
                Set <strong>Redirect URL</strong> to exactly:
                <br />
                <code>{anilist.REDIRECT_URL}</code>
                <br />
                <small>
                  AniList&rsquo;s own page. It shows the token for you to copy,
                  because this app has no web address a browser can return to.
                </small>
              </li>
              <li>Paste the client ID below, then tap Connect.</li>
              <li>Approve access, copy the code AniList shows, paste it below.</li>
            </ol>

            <label className="settings-field">
              <span>Client ID</span>
              <input
                type="text"
                inputMode="numeric"
                value={clientId}
                onChange={(e) => saveClientId(e.target.value)}
                placeholder="e.g. 12345"
              />
            </label>

            <a
              className={`btn btn-primary ${clientId ? '' : 'disabled'}`}
              href={clientId ? anilist.authorizeUrl(clientId) : undefined}
              aria-disabled={!clientId}
              target="_blank"
              rel="noreferrer"
            >
              Connect AniList
            </a>

            <label className="settings-field">
              <span>Token from AniList</span>
              <input
                type="text"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste the code AniList showed you"
              />
            </label>

            <button
              type="button"
              className="btn btn-secondary"
              disabled={!token.trim()}
              onClick={() => submit(token.trim())}
            >
              Save token
            </button>
          </>
        )}

        {status && (
          <p className={status.kind === 'error' ? 'metadata-error' : 'settings-hint'}>
            {status.message}
          </p>
        )}
      </section>

      <section className="settings-section">
        <h2>Other services</h2>
        <p className="settings-hint">
          Kitsu, MyAnimeList, Simkl and Trakt each need their own registered
          application. They are not connected yet, and are left off this
          screen rather than listed as buttons that would do nothing.
        </p>
      </section>
    </div>
  );
}
