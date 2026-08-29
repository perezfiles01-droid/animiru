import React, { useState, useEffect, useCallback } from 'react';
import { fetchRepository } from '../services/extensions/client';
import * as storage from '../services/extensions/storage';
import '../styles/Extensions.css';

/**
 * Adding extension repositories and installing sources from them.
 *
 * A repository is a URL to an index.json listing sources - the Mangayomi
 * format, so a repo published for that app works here unchanged. What the
 * user adds and installs is stored on this device only.
 *
 * The repository's own listing is re-fetched rather than cached in state
 * across visits, because an author's version bump should show up the next
 * time the user looks, not the next time they clear their storage.
 */
export default function ExtensionManager() {
  const [repos, setRepos] = useState(() => storage.getRepositories());
  const [installed, setInstalled] = useState(() => storage.getInstalledSources());
  const [catalogues, setCatalogues] = useState({});
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  /** Reads one repository's listing into state, or records why it could not. */
  const loadRepository = useCallback(async (repoUrl) => {
    setCatalogues((current) => ({
      ...current,
      [repoUrl]: { loading: true, sources: [], skipped: [], error: null }
    }));

    try {
      const { sources, skipped } = await fetchRepository(repoUrl);
      setCatalogues((current) => ({
        ...current,
        [repoUrl]: { loading: false, sources, skipped, error: null }
      }));
    } catch (err) {
      setCatalogues((current) => ({
        ...current,
        [repoUrl]: { loading: false, sources: [], skipped: [], error: err.message }
      }));
    }
  }, []);

  useEffect(() => {
    repos.forEach(loadRepository);
    // Only on mount and when the set of repositories changes - reloading on
    // every install would refetch the whole listing for a one-row change.
  }, [repos, loadRepository]);

  const handleAdd = async (e) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;

    setBusy(true);
    setError(null);
    try {
      // Validate before storing, so a typo does not leave a permanently
      // broken row in the list.
      await fetchRepository(trimmed);
      setRepos(storage.addRepository(trimmed));
      setUrl('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveRepo = (repoUrl) => {
    setRepos(storage.removeRepository(repoUrl));
    setInstalled(storage.getInstalledSources());
    setCatalogues((current) => {
      const next = { ...current };
      delete next[repoUrl];
      return next;
    });
  };

  const handleInstall = (source) => {
    setInstalled(storage.installSource(source));
  };

  const handleUninstall = (key) => {
    setInstalled(storage.uninstallSource(key));
  };

  const handleToggle = (key, enabled) => {
    setInstalled(storage.setSourceEnabled(key, enabled));
  };

  const installedByKey = new Map(installed.map((source) => [source.key, source]));

  return (
    <div className="extensions">
      <p className="settings-help">
        An extension repository is a URL to an <code>index.json</code> listing
        sources. Sources run on the Animiru server, and what you install here
        is remembered on this device only.
      </p>

      <form onSubmit={handleAdd} className="settings-form extensions-add">
        <label>
          Repository URL
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://raw.githubusercontent.com/user/repo/main/index.json"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck="false"
            required
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Checking...' : 'Add repository'}
        </button>
      </form>

      {error && <p className="extensions-error">{error}</p>}

      {repos.length === 0 && (
        <p className="extensions-empty">No repositories yet.</p>
      )}

      {repos.map((repoUrl) => {
        const catalogue = catalogues[repoUrl] || { loading: true, sources: [], skipped: [] };

        return (
          <section key={repoUrl} className="extensions-repo">
            <header className="extensions-repo-header">
              <span className="extensions-repo-url" title={repoUrl}>{repoUrl}</span>
              <span className="extensions-repo-actions">
                <button
                  type="button"
                  className="btn btn-link"
                  onClick={() => loadRepository(repoUrl)}
                >
                  Refresh
                </button>
                <button
                  type="button"
                  className="btn btn-link btn-danger"
                  onClick={() => handleRemoveRepo(repoUrl)}
                >
                  Remove
                </button>
              </span>
            </header>

            {catalogue.loading && <p className="extensions-status">Loading sources...</p>}
            {catalogue.error && <p className="extensions-error">{catalogue.error}</p>}

            {!catalogue.loading && !catalogue.error && catalogue.sources.length === 0 && (
              <p className="extensions-status">This repository lists no anime sources.</p>
            )}

            <ul className="extensions-list">
              {catalogue.sources.map((source) => {
                const current = installedByKey.get(source.key);
                const outdated = current && current.version !== source.version;

                return (
                  <li key={source.key} className="extensions-item">
                    {source.iconUrl && (
                      <img
                        src={source.iconUrl}
                        alt=""
                        className="extensions-icon"
                        // A source's icon is on its own site and often
                        // missing; a broken image should not leave a
                        // placeholder box in the row.
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    )}

                    <div className="extensions-item-text">
                      <span className="extensions-name">
                        {source.name}
                        {source.isNsfw && <span className="extensions-tag">18+</span>}
                        {!source.isMetadataCapable && (
                          <span className="extensions-tag" title="Plays episodes for titles found on AniList, but has no catalogue to browse">
                            video only
                          </span>
                        )}
                      </span>
                      <span className="extensions-meta">
                        {source.lang.toUpperCase()} · v{source.version}
                      </span>
                    </div>

                    <div className="extensions-item-actions">
                      {current && (
                        <label className="extensions-toggle">
                          <input
                            type="checkbox"
                            checked={current.enabled !== false}
                            onChange={(e) => handleToggle(source.key, e.target.checked)}
                          />
                          Enabled
                        </label>
                      )}

                      {outdated ? (
                        <button
                          type="button"
                          className="btn btn-primary btn-small"
                          onClick={() => handleInstall(source)}
                        >
                          Update to v{source.version}
                        </button>
                      ) : current ? (
                        <button
                          type="button"
                          className="btn btn-secondary btn-small"
                          onClick={() => handleUninstall(source.key)}
                        >
                          Uninstall
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-primary btn-small"
                          onClick={() => handleInstall(source)}
                        >
                          Install
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            {catalogue.skipped && catalogue.skipped.length > 0 && (
              <details className="extensions-skipped">
                <summary>{catalogue.skipped.length} entries not usable here</summary>
                <ul>
                  {catalogue.skipped.map((entry, index) => (
                    <li key={`${entry.name}-${index}`}>
                      <strong>{entry.name}</strong> — {entry.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        );
      })}
    </div>
  );
}
