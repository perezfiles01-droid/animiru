/**
 * The update screen's download.
 *
 * The button did nothing at all in the Android app, for reasons that were
 * invisible from the web side: it carried target="_blank", which a WebView
 * drops unless multiple windows are enabled, and there was no download
 * handler for the navigation either way. The web half of the fix is that the
 * link is an ordinary navigation the WebView's handler can catch - so that
 * is what these tests pin.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import UpdateSettings from '../UpdateSettings';
import { checkForUpdate } from '../../services/updates';

jest.mock('../../services/updates', () => ({
  ...jest.requireActual('../../services/updates'),
  CURRENT_VERSION: 'v1.0.46',
  checkForUpdate: jest.fn()
}));

const AVAILABLE = {
  version: 'v1.0.50',
  name: 'Animiru v1.0.50',
  notes: 'Fixed the update download.',
  url: 'https://github.com/x/y/releases/tag/v1.0.50',
  downloadUrl: 'https://github.com/x/y/releases/download/v1.0.50/animiru-app.apk',
  publishedAt: '2026-08-30T00:00:00Z',
  current: 'v1.0.46',
  isNewer: true
};

const renderScreen = () =>
  render(<MemoryRouter><UpdateSettings /></MemoryRouter>);

async function check() {
  renderScreen();
  await userEvent.click(screen.getByRole('button', { name: 'Check for update' }));
}

describe('the download link', () => {
  beforeEach(() => {
    window.localStorage.clear();
    checkForUpdate.mockReset();
  });

  it('is a plain navigation, not a new window', async () => {
    // target="_blank" is what a WebView drops. The whole failure was here,
    // and it stays true now the link sits behind the confirmation: the
    // download has to be an ordinary anchor the download handler can catch.
    checkForUpdate.mockResolvedValue(AVAILABLE);
    await check();
    await userEvent.click(await screen.findByRole('button', { name: /Download v1\.0\.50/ }));

    const link = await screen.findByRole('link', { name: 'Download and install' });
    expect(link).toHaveAttribute('href', AVAILABLE.downloadUrl);
    expect(link).not.toHaveAttribute('target');
  });

  it('says the download started rather than looking inert', async () => {
    checkForUpdate.mockResolvedValue(AVAILABLE);
    await check();

    await userEvent.click(await screen.findByRole('button', { name: /Download/ }));
    await userEvent.click(await screen.findByRole('link', { name: 'Download and install' }));

    expect(await screen.findByText(/progress appears in your notifications/))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Downloading v1\.0\.50/ })).toBeInTheDocument();
  });

  it('explains that the app cannot restart itself', async () => {
    // Android stops an app when its package is replaced; promising otherwise
    // would be a lie the OS enforces.
    checkForUpdate.mockResolvedValue(AVAILABLE);
    await check();

    expect(await screen.findByText(/cannot restart itself/)).toBeInTheDocument();
  });

  it('tells the user what to do if Android asks about unknown apps', async () => {
    checkForUpdate.mockResolvedValue(AVAILABLE);
    await check();

    expect(await screen.findByText(/permission to install unknown apps/))
      .toBeInTheDocument();
  });

  it('offers the release page when no APK is attached', async () => {
    checkForUpdate.mockResolvedValue({ ...AVAILABLE, downloadUrl: null });
    await check();

    const link = await screen.findByRole('link', { name: 'Open the release' });
    expect(link).toHaveAttribute('href', AVAILABLE.url);
    expect(link).not.toHaveAttribute('target');
  });

  it('clears the downloading state when checking again', async () => {
    checkForUpdate.mockResolvedValue(AVAILABLE);
    await check();
    await userEvent.click(await screen.findByRole('button', { name: /Download/ }));
    await userEvent.click(await screen.findByRole('link', { name: 'Download and install' }));
    await screen.findByText(/progress appears/);

    await userEvent.click(screen.getByRole('button', { name: 'Check for update' }));

    await waitFor(() =>
      expect(screen.queryByText(/progress appears/)).not.toBeInTheDocument());
  });

  it('shows no download when already up to date', async () => {
    checkForUpdate.mockResolvedValue({ ...AVAILABLE, isNewer: false });
    await check();

    expect(await screen.findByText(/latest version/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Download v/ })).not.toBeInTheDocument();
  });
});

/**
 * The backup buttons did nothing at all in the Android app: the export link
 * was intercepted before it could download, and the file input is inert in
 * a WebView with no file chooser. So the copy and paste path exists as the
 * one that depends on none of that.
 */
describe('backing up by copy and paste', () => {
  const storage = require('../../services/extensions/storage');
  const library = require('../../services/library');

  const withClipboard = (impl) => {
    Object.assign(navigator, { clipboard: { writeText: impl } });
  };

  beforeEach(() => {
    window.localStorage.clear();
    storage.addRepository('https://r.test/index.json');
    library.addToLibrary({
      id: '/a', providerId: 'extension:a', title: 'Frieren', poster: ''
    });
  });

  it('puts the backup on the clipboard', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    withClipboard(writeText);

    render(<MemoryRouter><UpdateSettings /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: /Copy backup/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toContain('animiru.backup');
    expect(await screen.findByText(/Copied\./)).toBeInTheDocument();
  });

  // A button that silently copies nothing is the failure this replaces, so
  // the text is on screen either way.
  it('shows the backup to copy by hand when the clipboard is refused', async () => {
    withClipboard(jest.fn().mockRejectedValue(new Error('denied')));

    render(<MemoryRouter><UpdateSettings /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: /Copy backup/i }));

    expect(await screen.findByText(/Could not reach the clipboard/)).toBeInTheDocument();
    // The whole point: the backup is still on screen to select by hand.
    expect(screen.getByLabelText('Backup contents').value).toContain('animiru.backup');
  });

  it('restores from pasted text', async () => {
    withClipboard(jest.fn().mockResolvedValue(undefined));

    render(<MemoryRouter><UpdateSettings /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: /Copy backup/i }));

    const backup = await screen.findByLabelText('Backup contents');
    const json = backup.value;

    window.localStorage.clear();

    await userEvent.click(screen.getByText(/Restore by pasting/i));
    fireEvent.change(screen.getByLabelText('Backup to restore'), { target: { value: json } });
    await userEvent.click(screen.getByRole('button', { name: /^Restore$/i }));

    expect(await screen.findByText(/Restored/)).toBeInTheDocument();
    expect(library.getLibrary()).toHaveLength(1);
  });

  it('says what is wrong with text that is not a backup', async () => {
    render(<MemoryRouter><UpdateSettings /></MemoryRouter>);

    await userEvent.click(screen.getByText(/Restore by pasting/i));
    fireEvent.change(screen.getByLabelText('Backup to restore'), { target: { value: 'not json' } });
    await userEvent.click(screen.getByRole('button', { name: /^Restore$/i }));

    expect(await screen.findByText(/not valid JSON/i)).toBeInTheDocument();
  });

  it('offers nothing to restore until something is pasted', async () => {
    render(<MemoryRouter><UpdateSettings /></MemoryRouter>);
    await userEvent.click(screen.getByText(/Restore by pasting/i));

    expect(screen.getByRole('button', { name: /^Restore$/i })).toBeDisabled();
  });

  it('warns that the backup carries account access', () => {
    render(<MemoryRouter><UpdateSettings /></MemoryRouter>);
    expect(screen.getByText(/AniList token.*keep it somewhere private/s)).toBeInTheDocument();
  });
});

/**
 * What the confirmation says before the download starts.
 *
 * Someone who has been uninstalling by hand before every update has been
 * throwing away their library each time without being told they never had
 * to. This is the moment to say so - after they have decided to update and
 * before anything is downloaded.
 */
describe('the dialog before the download', () => {
  const openIt = async () => {
    checkForUpdate.mockResolvedValue(AVAILABLE);
    await check();
    await userEvent.click(await screen.findByRole('button', { name: /Download v1\.0\.50/ }));
  };

  it('says not to delete the app first', async () => {
    await openIt();
    expect(await screen.findByText(/Do not delete the app first/i)).toBeInTheDocument();
  });

  it('says what is kept', async () => {
    await openIt();
    expect(await screen.findByText(/keeps your library/i)).toBeInTheDocument();
  });

  it('points at the backup before anything destructive', async () => {
    await openIt();
    expect(await screen.findByText(/Take a backup first/i)).toBeInTheDocument();
  });

  // The one case where uninstalling really is required, with the warning
  // that it costs the library - so it is a last resort, not the routine.
  it('explains the App not installed case and its cost', async () => {
    await openIt();
    expect(await screen.findByText(/App not installed/)).toBeInTheDocument();
    expect(screen.getByText(/deletes the app storage/i)).toBeInTheDocument();
  });

  // Nothing downloads until it is confirmed; a dialog that has already
  // started the download is decoration.
  it('starts nothing until it is confirmed', async () => {
    await openIt();
    expect(screen.queryByText(/progress appears/)).not.toBeInTheDocument();
  });

  it('closes without downloading when cancelled', async () => {
    await openIt();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText(/Do not delete the app first/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/progress appears/)).not.toBeInTheDocument();
  });
});
