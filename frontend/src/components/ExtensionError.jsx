import React, { useState } from 'react';
import { CURRENT_VERSION } from '../services/updates';
import '../styles/Extensions.css';

/**
 * What went wrong with a source, in enough detail to act on.
 *
 * A scraper breaks for dull reasons - a class name changed, the site started
 * returning an error page, the server got rate-limited - and the raw message
 * for most of those is "Cannot read properties of null", which says nothing
 * about which selector or what to do.
 *
 * So the cause and the fix lead, the failing line is quoted from the source
 * itself, and the request trace is one tap away. The trace is often the
 * whole answer: a 403 above a null selector means the site blocked the
 * fetch, not that the markup moved.
 */

/**
 * Which app and which backend produced this failure.
 *
 * A screenshot of an error cannot be acted on without it. The same failure
 * was reported three times running while the fix sat in the repository
 * unmerged, because nothing on screen distinguished "the fix does not work"
 * from "this build does not have the fix". Now the report says.
 *
 * Read from the failure rather than fetched: the backend stamps its build
 * onto the report it sends, so this names the code that actually served the
 * request. Asking afterwards would answer a different question - what is
 * deployed now - and would be a request made from a screen whose whole
 * subject is a request that failed.
 */
function BuildStamp({ build }) {
  return (
    <section>
      <h4>Build</h4>
      <ul className="ext-error-build">
        <li>App: {CURRENT_VERSION || 'development'}</li>
        <li>
          Backend: {(build && build.shortCommit) || 'unknown'}
          {build && build.branch && build.branch !== 'unknown' && ` (${build.branch})`}
        </li>
      </ul>
    </section>
  );
}

export default function ExtensionErrorReport({ error, compact }) {
  const [open, setOpen] = useState(false);

  if (!error) return null;

  const diagnostics = error.diagnostics || null;
  const message = error.message || String(error);

  if (!diagnostics) {
    return <p className="extensions-error">{message}</p>;
  }

  return (
    <div className="ext-error">
      <p className="ext-error-cause">{diagnostics.cause}</p>

      {!compact && diagnostics.fix && (
        <p className="ext-error-fix">{diagnostics.fix}</p>
      )}

      {diagnostics.failedRequests && diagnostics.failedRequests.length > 0 && (
        <p className="ext-error-hint">
          {diagnostics.failedRequests.length === 1 ? 'A request' : 'Requests'} failed
          first: {diagnostics.failedRequests.map((request) => (
            request.error || `${request.status}`
          )).join(', ')} — that is usually the real cause.
        </p>
      )}

      <button type="button" className="btn btn-link" onClick={() => setOpen(!open)}>
        {open ? 'Hide details' : 'Show details'}
      </button>

      {open && (
        <div className="ext-error-details">
          <section>
            <h4>Error</h4>
            <p className="ext-error-message">{message}</p>
            {diagnostics.location && (
              <p className="ext-error-where">
                {diagnostics.source.name || 'Source'}
                {diagnostics.source.version && ` v${diagnostics.source.version}`}
                {' · '}
                {diagnostics.method && `${diagnostics.method}() · `}
                line {diagnostics.location.line}
                {diagnostics.location.where && ` in ${diagnostics.location.where}`}
              </p>
            )}
          </section>

          {diagnostics.excerpt && (
            <section>
              <h4>Where it failed</h4>
              <pre className="ext-error-code">
                {diagnostics.excerpt.map((line) => (
                  <span
                    key={line.number}
                    className={`ext-error-line ${line.failing ? 'failing' : ''}`}
                  >
                    <span className="ext-error-lineno">{line.number}</span>
                    {line.text}
                  </span>
                ))}
              </pre>
            </section>
          )}

          {diagnostics.requests && diagnostics.requests.length > 0 && (
            <section>
              <h4>Requests ({diagnostics.requests.length})</h4>
              <ul className="ext-error-requests">
                {diagnostics.requests.map((request, index) => (
                  <li key={index} className={request.error || request.status >= 400 ? 'failed' : ''}>
                    <span className="ext-error-method">{request.method}</span>
                    <span className="ext-error-url" title={request.url}>{request.url}</span>
                    <span className="ext-error-outcome">
                      {request.error || `${request.status} · ${request.durationMs}ms`}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {diagnostics.logs && diagnostics.logs.length > 0 && (
            <section>
              <h4>Console</h4>
              <ul className="ext-error-logs">
                {diagnostics.logs.map((entry, index) => (
                  <li key={index} className={`log-${entry.level}`}>{entry.message}</li>
                ))}
              </ul>
            </section>
          )}

          {diagnostics.attempts && (
            /*
             * What each road reported, for a failure where both were tried.
             * The headline says the site is down; this is the evidence for
             * that, kept out of the way of someone who only needs the
             * conclusion.
             */
            <section>
              <h4>What was tried</h4>
              <ul className="ext-error-attempts">
                <li>Server: {diagnostics.attempts.server}</li>
                <li>This device: {diagnostics.attempts.device}</li>
              </ul>
            </section>
          )}

          <BuildStamp build={diagnostics.build} />

          {diagnostics.source.codeUrl && (
            <section>
              <h4>Source file</h4>
              <a
                href={diagnostics.source.codeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ext-error-url"
              >
                {diagnostics.source.codeUrl}
              </a>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
