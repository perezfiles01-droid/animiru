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
import { render, screen, waitFor } from '@testing-library/react';
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
    // target="_blank" is what a WebView drops. The whole failure was here.
    checkForUpdate.mockResolvedValue(AVAILABLE);
    await check();

    const link = await screen.findByRole('link', { name: /Download v1\.0\.50/ });
    expect(link).toHaveAttribute('href', AVAILABLE.downloadUrl);
    expect(link).not.toHaveAttribute('target');
  });

  it('says the download started rather than looking inert', async () => {
    checkForUpdate.mockResolvedValue(AVAILABLE);
    await check();

    await userEvent.click(await screen.findByRole('link', { name: /Download/ }));

    expect(await screen.findByText(/progress appears in your notifications/))
      .toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Downloading v1\.0\.50/ })).toBeInTheDocument();
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
    await userEvent.click(await screen.findByRole('link', { name: /Download/ }));
    await screen.findByText(/progress appears/);

    await userEvent.click(screen.getByRole('button', { name: 'Check for update' }));

    await waitFor(() =>
      expect(screen.queryByText(/progress appears/)).not.toBeInTheDocument());
  });

  it('shows no download when already up to date', async () => {
    checkForUpdate.mockResolvedValue({ ...AVAILABLE, isNewer: false });
    await check();

    expect(await screen.findByText(/latest version/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Download/ })).not.toBeInTheDocument();
  });
});
