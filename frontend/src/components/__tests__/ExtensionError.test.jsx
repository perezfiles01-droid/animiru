/**
 * The failure report.
 *
 * What it shows before you tap is what someone acts on; what it hides is
 * what they read only once they have decided to dig. Both matter: a broken
 * source that fills the screen with a stack trace is as unhelpful as one
 * that says "error".
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ExtensionErrorReport from '../ExtensionError';

function errorWith(diagnostics) {
  const error = new Error('Cannot read properties of null (reading \'text\')');
  error.diagnostics = {
    message: error.message,
    method: 'search',
    source: { name: 'Example', version: '1.2.0', codeUrl: 'https://repo.test/e.js' },
    cause: 'A selector matched nothing, and the code then read .text from it.',
    fix: 'selectFirst() returns null when nothing matches.',
    location: { line: 12, column: 20, where: 'DefaultExtension.search' },
    excerpt: [
      { number: 11, text: '    const doc = new Document(res.body);', failing: false },
      { number: 12, text: '    return doc.selectFirst(".card").text;', failing: true },
      { number: 13, text: '  }', failing: false }
    ],
    requests: [
      { method: 'GET', url: 'https://site.test/a', status: 200, durationMs: 120 },
      { method: 'GET', url: 'https://site.test/b', status: 403, durationMs: 90 }
    ],
    failedRequests: [{ method: 'GET', url: 'https://site.test/b', status: 403, durationMs: 90 }],
    logs: [{ level: 'warn', message: 'markup looked odd' }],
    ...diagnostics
  };
  return error;
}

describe('ExtensionErrorReport', () => {
  it('leads with the cause, not the raw message', () => {
    render(<ExtensionErrorReport error={errorWith()} />);

    expect(screen.getByText(/A selector matched nothing/)).toBeInTheDocument();
    // The raw message is available, but not what greets you.
    expect(screen.queryByText(/Cannot read properties of null/)).not.toBeInTheDocument();
  });

  it('offers a fix', () => {
    render(<ExtensionErrorReport error={errorWith()} />);
    expect(screen.getByText(/selectFirst\(\) returns null/)).toBeInTheDocument();
  });

  it('calls out a failed request as the likely real cause', () => {
    render(<ExtensionErrorReport error={errorWith()} />);
    expect(screen.getByText(/403.*usually the real cause/)).toBeInTheDocument();
  });

  it('keeps the detail behind one tap', async () => {
    render(<ExtensionErrorReport error={errorWith()} />);
    expect(screen.queryByText('Where it failed')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Show details' }));

    expect(screen.getByText('Where it failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide details' })).toBeInTheDocument();
  });

  describe('once opened', () => {
    async function open() {
      render(<ExtensionErrorReport error={errorWith()} />);
      await userEvent.click(screen.getByRole('button', { name: 'Show details' }));
    }

    it('quotes the failing line and marks it', async () => {
      await open();

      const failing = screen.getByText(/selectFirst\(".card"\).text/).closest('span');
      expect(failing).toHaveClass('failing');
      expect(screen.getByText('12')).toBeInTheDocument();
    });

    it('names the source, method and line', async () => {
      await open();
      expect(screen.getByText(/Example v1.2.0 · search\(\) · line 12/)).toBeInTheDocument();
    });

    it('lists every request, marking the ones that failed', async () => {
      await open();

      expect(screen.getByText('Requests (2)')).toBeInTheDocument();
      const failed = screen.getByText('403 · 90ms').closest('li');
      expect(failed).toHaveClass('failed');
    });

    it('shows what the source logged', async () => {
      await open();
      expect(screen.getByText('markup looked odd')).toBeInTheDocument();
    });

    it('links to the source file, so the line can be read in context', async () => {
      await open();
      expect(screen.getByRole('link', { name: 'https://repo.test/e.js' }))
        .toHaveAttribute('href', 'https://repo.test/e.js');
    });
  });

  it('falls back to the plain message when there are no diagnostics', () => {
    render(<ExtensionErrorReport error={new Error('Something broke')} />);

    expect(screen.getByText('Something broke')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show details' })).not.toBeInTheDocument();
  });

  it('renders nothing when there is no error', () => {
    const { container } = render(<ExtensionErrorReport error={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('omits the fix in compact mode, where space is short', () => {
    render(<ExtensionErrorReport error={errorWith()} compact />);

    expect(screen.getByText(/A selector matched nothing/)).toBeInTheDocument();
    expect(screen.queryByText(/selectFirst\(\) returns null/)).not.toBeInTheDocument();
  });
});

/**
 * Which build produced the failure.
 *
 * The same error was reported three times running while the fix sat
 * unmerged in the repository, because nothing on screen distinguished "the
 * fix does not work" from "this build does not have the fix". A screenshot
 * has to answer that on its own.
 */
describe('naming the build that failed', () => {
  const openWith = async (build) => {
    const error = errorWith();
    error.diagnostics.build = build;
    render(<ExtensionErrorReport error={error} />);
    await userEvent.click(screen.getByText(/Show details/i));
  };

  it('names the backend build the failure came from', async () => {
    await openWith({ shortCommit: 'ce1651f', branch: 'main' });
    expect(screen.getByText(/ce1651f/)).toBeInTheDocument();
  });

  it('names the branch that build came from', async () => {
    await openWith({ shortCommit: 'ce1651f', branch: 'main' });
    expect(screen.getByText(/main/)).toBeInTheDocument();
  });

  // A backend too old to stamp its build reads as unknown - never as
  // though the build were current. That is the case this exists for: it is
  // exactly what a deployment predating this change will send.
  it('says unknown when the failure carries no build', async () => {
    await openWith(undefined);
    expect(screen.getByText(/Backend: unknown/)).toBeInTheDocument();
  });
});

/**
 * A failure where both the server and the device were tried.
 *
 * The headline says the site is down. The evidence for that - what each
 * road actually reported - belongs in the details, where someone who wants
 * it can find it and someone who only needs the conclusion is not made to
 * read two stack-shaped strings first.
 */
describe('a failure both roads hit', () => {
  const bothFailed = () => {
    const error = new Error('This site is not answering.');
    error.diagnostics = {
      message: error.message,
      cause: 'The site did not answer the server or this device.',
      fix: 'Two networks, the same result.',
      source: {},
      requests: [],
      logs: [],
      failedRequests: [],
      attempts: {
        server: 'timeout of 5695ms exceeded',
        device: 'Software caused connection abort'
      }
    };
    return error;
  };

  it('shows what each road reported, once opened', async () => {
    render(<ExtensionErrorReport error={bothFailed()} />);
    await userEvent.click(screen.getByText(/Show details/i));

    expect(screen.getByText(/timeout of 5695ms exceeded/)).toBeInTheDocument();
    expect(screen.getByText(/Software caused connection abort/)).toBeInTheDocument();
  });

  // Before the tap, the conclusion and nothing else.
  it('keeps the technical detail out of the summary', () => {
    render(<ExtensionErrorReport error={bothFailed()} />);

    expect(screen.queryByText(/Software caused connection abort/)).not.toBeInTheDocument();
    expect(screen.getByText(/did not answer the server or this device/)).toBeInTheDocument();
  });

  // Every other failure has no attempts to show and must not render an
  // empty section.
  it('shows nothing of the sort for an ordinary failure', async () => {
    render(<ExtensionErrorReport error={errorWith()} />);
    await userEvent.click(screen.getByText(/Show details/i));

    expect(screen.queryByText('What was tried')).not.toBeInTheDocument();
  });
});
