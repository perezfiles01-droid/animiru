import React, { useState, useEffect, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import { runSource, publishSource, canPublish } from '../services/extensions/client';
import { SKELETON } from '../services/extensions/skeleton';
import '../styles/Maker.css';

const DRAFT_KEY = 'animiru.extensions.draft';

/**
 * Arguments each method is called with when tested.
 *
 * A source method takes whatever the app would pass it, and the useful test
 * is the one the app would actually make - so the panel supplies real
 * arguments rather than asking the author to type JSON.
 */
const METHOD_ARGS = {
  getPopular: (input) => [Number(input.page) || 1],
  getLatestUpdates: (input) => [Number(input.page) || 1],
  search: (input) => [input.query || '', Number(input.page) || 1, []],
  getDetail: (input) => [input.url || ''],
  getVideoList: (input) => [input.url || ''],
  getSourcePreferences: () => []
};

const METHODS = Object.keys(METHOD_ARGS);

/** Methods that need a URL rather than a query. */
const URL_METHODS = new Set(['getDetail', 'getVideoList']);

/**
 * Write a source and watch it run.
 *
 * The panel on the right is the reason this page exists. Writing a scraper
 * is a loop of changing one selector and seeing what comes back, and doing
 * that against a published file is unbearable - so a draft runs on the
 * server without being published at all, and reports what it returned, what
 * it logged, and every HTTP request it made along the way. When a selector
 * stops matching, the request log is what tells you whether the page
 * changed or the fetch failed.
 */
export default function ExtensionMaker() {
  const [code, setCode] = useState(() => {
    try {
      return window.localStorage.getItem(DRAFT_KEY) || SKELETON;
    } catch (err) {
      return SKELETON;
    }
  });

  const [method, setMethod] = useState('getPopular');
  const [input, setInput] = useState({ page: 1, query: '', url: '' });
  const [outcome, setOutcome] = useState(null);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);

  const [fileName, setFileName] = useState('my-source.js');
  const [publishable, setPublishable] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(null);

  useEffect(() => {
    canPublish().then(setPublishable);
  }, []);

  // The draft is the author's work in progress and losing it to a refresh
  // would be the worst thing this page could do.
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        window.localStorage.setItem(DRAFT_KEY, code);
      } catch (err) {
        // A full store costs the draft, not the session.
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [code]);

  const handleRun = useCallback(async () => {
    setRunning(true);
    setError(null);
    setOutcome(null);

    try {
      setOutcome(await runSource({ code, method, args: METHOD_ARGS[method](input) }));
    } catch (err) {
      // A failed run still carries logs and a request trace, and those are
      // what diagnose it, so they are kept rather than replaced by the
      // message alone.
      setError(err.message);
      setOutcome({ result: null, logs: err.logs || [], requests: err.requests || [] });
    } finally {
      setRunning(false);
    }
  }, [code, method, input]);

  const handlePublish = async () => {
    setPublishing(true);
    setError(null);
    setPublished(null);

    try {
      const result = await publishSource({ fileName, code });
      setPublished(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setPublishing(false);
    }
  };

  const handleReset = () => {
    if (window.confirm('Replace the current draft with the starting template?')) {
      setCode(SKELETON);
    }
  };

  return (
    <div className="maker">
      <header className="maker-header">
        <h1>Extension maker</h1>
        <div className="maker-header-actions">
          <button type="button" className="btn btn-link" onClick={handleReset}>
            Reset to template
          </button>
        </div>
      </header>

      <div className="maker-body">
        <div className="maker-editor">
          <Editor
            height="100%"
            defaultLanguage="javascript"
            theme="vs-dark"
            value={code}
            onChange={(value) => setCode(value ?? '')}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              scrollBeyondLastLine: false,
              tabSize: 2
            }}
          />
        </div>

        <aside className="maker-panel">
          <section className="maker-run">
            <h2>Run</h2>

            <label>
              Method
              <select value={method} onChange={(e) => setMethod(e.target.value)}>
                {METHODS.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>

            {URL_METHODS.has(method) ? (
              <label>
                URL
                <input
                  type="text"
                  value={input.url}
                  onChange={(e) => setInput({ ...input, url: e.target.value })}
                  placeholder="A link from a list this source returned"
                  autoCapitalize="none"
                  spellCheck="false"
                />
              </label>
            ) : method === 'search' ? (
              <>
                <label>
                  Query
                  <input
                    type="text"
                    value={input.query}
                    onChange={(e) => setInput({ ...input, query: e.target.value })}
                  />
                </label>
                <label>
                  Page
                  <input
                    type="number"
                    min="1"
                    value={input.page}
                    onChange={(e) => setInput({ ...input, page: e.target.value })}
                  />
                </label>
              </>
            ) : method !== 'getSourcePreferences' ? (
              <label>
                Page
                <input
                  type="number"
                  min="1"
                  value={input.page}
                  onChange={(e) => setInput({ ...input, page: e.target.value })}
                />
              </label>
            ) : null}

            <button
              type="button"
              className="btn btn-primary"
              onClick={handleRun}
              disabled={running}
            >
              {running ? 'Running...' : `Run ${method}()`}
            </button>
          </section>

          {error && <p className="extensions-error">{error}</p>}

          {outcome && (
            <>
              {outcome.result !== null && outcome.result !== undefined && (
                <section className="maker-result">
                  <h2>
                    Result
                    {typeof outcome.durationMs === 'number' && (
                      <span className="maker-timing">{outcome.durationMs}ms</span>
                    )}
                  </h2>
                  <pre>{JSON.stringify(outcome.result, null, 2)}</pre>
                </section>
              )}

              {outcome.requests && outcome.requests.length > 0 && (
                <section className="maker-requests">
                  <h2>Requests</h2>
                  <ul>
                    {outcome.requests.map((request, index) => (
                      <li key={index} className={request.error ? 'failed' : ''}>
                        <span className="maker-request-method">{request.method}</span>
                        <span className="maker-request-url" title={request.url}>
                          {request.url}
                        </span>
                        <span className="maker-request-status">
                          {request.error || `${request.status} · ${request.durationMs}ms`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {outcome.logs && outcome.logs.length > 0 && (
                <section className="maker-logs">
                  <h2>Console</h2>
                  <ul>
                    {outcome.logs.map((entry, index) => (
                      <li key={index} className={`log-${entry.level}`}>{entry.message}</li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}

          <section className="maker-publish">
            <h2>Publish</h2>

            {publishable ? (
              <>
                <label>
                  File name
                  <input
                    type="text"
                    value={fileName}
                    onChange={(e) => setFileName(e.target.value)}
                    autoCapitalize="none"
                    spellCheck="false"
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handlePublish}
                  disabled={publishing}
                >
                  {publishing ? 'Publishing...' : 'Publish to repository'}
                </button>
                {published && (
                  <p className="maker-published">
                    {published.created ? 'Published' : 'Updated'}{' '}
                    <strong>{published.entry.name}</strong> v{published.entry.version} at{' '}
                    <code>{published.path}</code>
                  </p>
                )}
              </>
            ) : (
              <p className="settings-help">
                This server has no publishing repository configured, so a source
                written here can only be tested. Set GITHUB_TOKEN and
                EXTENSION_REPO to enable it.
              </p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
