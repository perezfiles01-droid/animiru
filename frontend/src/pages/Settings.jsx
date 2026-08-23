import React, { useState } from 'react';
import jellyfin, {
  connect,
  disconnect,
  getConfig
} from '../services/providers/jellyfin';
import '../styles/Pages.css';

/**
 * Connects the app to a Jellyfin server.
 *
 * Credentials are exchanged for an access token once; the password is never
 * stored. The token lives in localStorage on the device, which is the same
 * place every Jellyfin web client keeps it.
 */
export default function Settings() {
  const [server, setServer] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [connection, setConnection] = useState(() => getConfig());

  const handleConnect = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setConnection(await connect({ server, username, password }));
      setPassword('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = () => {
    disconnect();
    setConnection(null);
  };

  return (
    <div className="settings-page">
      <h1>Settings</h1>

      <section className="settings-section">
        <h2>Jellyfin</h2>

        {connection ? (
          <div className="settings-connected">
            <p>
              Connected to <strong>{connection.server}</strong> as{' '}
              <strong>{connection.username}</strong>
            </p>
            <button onClick={handleDisconnect} className="btn btn-secondary">
              Disconnect
            </button>
          </div>
        ) : (
          <>
            <p className="settings-help">
              Jellyfin is a free media server you run yourself. Point this at
              your server to browse your library and stream it here, with real
              quality selection.
            </p>

            <form onSubmit={handleConnect} className="settings-form">
              <label>
                Server address
                <input
                  type="text"
                  value={server}
                  onChange={(e) => setServer(e.target.value)}
                  placeholder="http://192.168.1.10:8096"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck="false"
                  required
                />
              </label>

              <label>
                Username
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck="false"
                  required
                />
              </label>

              <label>
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Leave blank if your account has no password"
                />
              </label>

              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Connecting...' : 'Connect'}
              </button>
            </form>

            {error && <p className="error">{error}</p>}

            <p className="settings-note">
              Use the address you open Jellyfin at. On the same Wi-Fi that is
              usually a local address like http://192.168.1.10:8096.
            </p>
          </>
        )}
      </section>

      <section className="settings-section">
        <h2>Sources</h2>
        <ul className="settings-sources">
          <li>
            <strong>{jellyfin.name}</strong>
            <span className="settings-source-state">
              {jellyfin.isConfigured() ? 'Connected' : 'Not configured'}
            </span>
          </li>
          <li>
            <strong>AniList</strong>
            <span className="settings-source-state">
              Always on &mdash; metadata and discovery
            </span>
          </li>
        </ul>
      </section>
    </div>
  );
}
