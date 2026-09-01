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
  /** Set while the "before you install" dialog is open. */
  const [confirming, setConfirming] = useState(false);
  const [backupText, setBackupText] = useState('');
  const [pasted, setPasted] = useState('');
  const [copied, setCopied] = useState(false);
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
  /**
   * Saves the backup as a file.
   *
   * This is the convenient path, not the reliable one. In the Android app
   * the link is intercepted before it can download: shouldOverrideUrlLoading
   * only treats .apk as a download and hands everything else to the browser,
   * which cannot open a data: URL - so the button did nothing at all. The
   * shell now recognises a backup, but a WebView cannot be tested from where
   * this is written, so the copy button below is the path that does not
   * depend on any of it.
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

  /**
   * Puts the backup on the clipboard, and on screen as well.
   *
   * Nothing here needs a download handler, a file chooser or a permission,
   * which is the point: it works whatever the WebView does. The text is
   * shown too, because clipboard access is itself refused in some webviews
   * and a button that silently copies nothing is the failure this replaces.
   */
  const handleCopy = async () => {
    const json = exportSettings();
    setBackupText(json);
    setCopied(false);

    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
    } catch (err) {
      // Left on screen to select by hand, which always works.
    }
  };

  const handlePaste = () => {
    setError(null);
    setRestored(null);

    try {
      setRestored(importSettings(pasted));
      setPasted('');
    } catch (err) {
      setError(err.message);
    }
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
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setConfirming(true)}
              >
                {downloading ? `Downloading ${result.version}...` : `Download ${result.version}`}
              </button>
            ) : (
              <a className="btn btn-secondary" href={result.url}>
                Open the release
              </a>
            )}

            {confirming && (
              /*
               * What happens next, before it happens.
               *
               * Installing over the current app keeps everything; deleting
               * it first does not. Someone who has been uninstalling by hand
               * has been throwing away their library every update without
               * being told they never had to, so this says so at the moment
               * it matters.
               */
              <div className="update-confirm" role="dialog" aria-label="Before you install">
                <h4>Before you install</h4>

                <ul>
                  <li>
                    <strong>Do not delete the app first.</strong> This installs
                    over the current one and keeps your library, repositories,
                    sources and settings.
                  </li>
                  <li>
                    The download runs in your notifications. When it finishes
                    the installer opens - tap <strong>Update</strong> or
                    <strong> Install</strong>, then <strong>Open</strong>.
                  </li>
                  <li>
                    Take a backup first if you want to be certain - the Backup
                    section below copies everything as text.
                  </li>
                </ul>

                <p className="settings-help">
                  If Android refuses with &quot;App not installed&quot;, the
                  signing key differs and uninstalling is the only way past
                  it. Save a backup before doing that: uninstalling deletes
                  the app storage your library lives in.
                </p>

                <div className="update-confirm-actions">
                  {/*
                    * The real download stays an ordinary anchor navigation.
                    * The WebView's download handler needs one; a programmatic
                    * click or a new window is dropped, which is how this
                    * button came to do nothing at all once before.
                    */}
                  <a
                    className="btn btn-primary"
                    href={result.downloadUrl}
                    onClick={() => { setDownloading(true); setConfirming(false); }}
                  >
                    Download and install
                  </a>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setConfirming(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
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
          Your library, sources, repositories and AniList connection, as
          text you keep. Take one before installing a new build.
        </p>
        <p className="settings-help">
          The backup contains your AniList token if you have connected one,
          which is account access - keep it somewhere private.
        </p>

        <div className="update-backup-actions">
          <button type="button" className="btn btn-primary" onClick={handleCopy}>
            Copy backup
          </button>
          <button type="button" className="btn btn-secondary" onClick={handleExport}>
            Save as file
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => fileInput.current && fileInput.current.click()}
          >
            Restore from file
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

        {backupText && (
          <div className="update-backup-text">
            <p className="update-status">
              {copied
                ? 'Copied. Paste it somewhere you will still have after a '
                  + 'reinstall - a note, an email to yourself.'
                : 'Could not reach the clipboard, so here it is to select '
                  + 'and copy by hand.'}
            </p>
            <textarea
              readOnly
              value={backupText}
              rows={6}
              aria-label="Backup contents"
              onFocus={(e) => e.target.select()}
            />
          </div>
        )}

        <details className="update-backup-restore">
          <summary>Restore by pasting a backup</summary>
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={6}
            placeholder="Paste the backup text here"
            aria-label="Backup to restore"
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={!pasted.trim()}
            onClick={handlePaste}
          >
            Restore
          </button>
        </details>

        {restored && (
          <p className="update-status">
            Restored {restored.sources} source{restored.sources === 1 ? '' : 's'} from{' '}
            {restored.repositories} repositor{restored.repositories === 1 ? 'y' : 'ies'}
            {typeof restored.library === 'number'
              && `, and ${restored.library} title${restored.library === 1 ? '' : 's'} in the library`}
            . Reopen the app for it to take effect everywhere.
          </p>
        )}
      </section>
    </SettingsScreen>
  );
}
