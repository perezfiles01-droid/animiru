import React, { useState, useRef } from 'react';
import SettingsScreen from '../components/SettingsScreen';
import {
  CURRENT_VERSION, checkForUpdate, getCheckOnStartup, setCheckOnStartup
} from '../services/updates';
import { exportSettings, importSettings } from '../services/extensions/backup';
import '../styles/Settings.css';

/**
 * The version this build is, and whether a newer one exists.
 *
 * The release notes are shown in full rather than summarised: what changed
 * is the reason to update, and hiding it behind a link on a phone means
 * nobody reads it.
 */
export default function UpdateSettings() {
  const [startup, setStartup] = useState(() => getCheckOnStartup());
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [restored, setRestored] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const fileInput = useRef(null);

  const handleCheck = async () => {
    setChecking(true);
    setError(null);
    setResult(null);
    setDownloading(false);
    try {
      setResult(await checkForUpdate());
    } catch (err) {
      setError(err.message);
    } finally {
      setChecking(false);
    }
  };

  const handleStartup = (enabled) => {
    setStartup(setCheckOnStartup(enabled));
  };

  /**
   * Saves the backup as a file.
   *
   * A data: URL rather than a blob: the Android WebView refuses some blob
   * downloads, and this file is small enough that the difference costs
   * nothing.
   */
  const handleExport = () => {
    const json = exportSettings();
    const link = document.createElement('a');
    link.href = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
    link.download = `animiru-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const handleImport = async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    setError(null);
    setRestored(null);
    try {
      const restoredCounts = importSettings(await file.text());
      setRestored(restoredCounts);
    } catch (err) {
      setError(err.message);
    } finally {
      // Clearing lets the same file be chosen twice in a row.
      event.target.value = '';
    }
  };

  return (
    <SettingsScreen title="Update" summary="Which version this is, and whether a newer one exists.">
      <section className="settings-section">
        <div className="update-version">
          <span className="update-version-label">Version</span>
          <strong className="update-version-value">
            {CURRENT_VERSION || 'Development build'}
          </strong>
        </div>

        <label className="update-toggle">
          <input
            type="checkbox"
            checked={startup}
            onChange={(e) => handleStartup(e.target.checked)}
          />
          Check for app updates on startup
        </label>

        <button
          type="button"
          className="btn btn-primary"
          onClick={handleCheck}
          disabled={checking}
        >
          {checking ? 'Checking...' : 'Check for update'}
        </button>

        {error && <p className="extensions-error">{error}</p>}

        {result && !result.isNewer && (
          <p className="update-status">
            {CURRENT_VERSION
              ? `You are on the latest version (${result.version}).`
              : `The latest release is ${result.version}. This build does not `
                + 'report a version, so there is nothing to compare it against.'}
          </p>
        )}

        {result && result.isNewer && (
          <div className="update-available">
            <h3>{result.name} is available</h3>
            <p className="update-status">
              You are on {result.current}.
              {result.publishedAt
                && ` Released ${new Date(result.publishedAt).toLocaleDateString()}.`}
            </p>

            {result.notes && (
              <div className="update-notes">
                <h4>What changed</h4>
                <pre>{result.notes}</pre>
              </div>
            )}

            {result.downloadUrl ? (
              <a
                className="btn btn-primary"
                href={result.downloadUrl}
                // Deliberately not target="_blank". In the Android app the
                // download is caught by the WebView's download handler,
                // which needs an ordinary navigation; a new window was
                // dropped outright and the button did nothing at all.
                onClick={() => setDownloading(true)}
              >
                {downloading ? `Downloading ${result.version}...` : `Download ${result.version}`}
              </a>
            ) : (
              <a className="btn btn-secondary" href={result.url}>
                Open the release
              </a>
            )}

            {downloading && (
              <p className="update-status">
                The download is running - progress appears in your
                notifications. When it finishes the installer opens; tap
                Install, then Open.
              </p>
            )}

            <p className="settings-help update-safety">
              Installing over the current app keeps your repositories and
              installed sources. Android preserves app storage across an
              update when the package and signing key match, and that is
              where they live.
            </p>

            <p className="settings-help">
              The app cannot restart itself: Android stops it when its
              package is replaced, so the installer's own Open button is the
              way back in. If Android asks for permission to install unknown
              apps, grant it and tap Download again.
            </p>
          </div>
        )}
      </section>

      <section className="settings-section">
        <h2>Backup</h2>
        <p className="settings-help">
          An update keeps your settings. This is for everything else - a new
          phone, cleared data, or a build installed with a different
          signature, any of which starts the app empty.
        </p>

        <div className="update-backup-actions">
          <button type="button" className="btn btn-secondary" onClick={handleExport}>
            Export settings
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => fileInput.current && fileInput.current.click()}
          >
            Import settings
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            onChange={handleImport}
            hidden
            aria-label="Backup file"
          />
        </div>

        {restored && (
          <p className="update-status">
            Restored {restored.sources} source{restored.sources === 1 ? '' : 's'} from{' '}
            {restored.repositories} repositor{restored.repositories === 1 ? 'y' : 'ies'}.
          </p>
        )}
      </section>
    </SettingsScreen>
  );
}
