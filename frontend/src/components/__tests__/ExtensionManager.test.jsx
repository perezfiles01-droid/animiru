/**
 * The manager is where a user meets a repository for the first time, so
 * these tests cover what they see when one is fine, when it is broken, and
 * when it lists things Animiru cannot use.
 */

import React from 'react';
import { render as rtlRender, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import ExtensionManager from '../ExtensionManager';
import { fetchRepository } from '../../services/extensions/client';
import * as storage from '../../services/extensions/storage';

jest.mock('../../services/extensions/client', () => ({ fetchRepository: jest.fn() }));

/** The manager links to the maker, so it needs a router around it. */
const render = (ui) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

const REPO = 'https://repo.test/index.json';

function source(overrides = {}) {
  return {
    key: `${REPO}#42`,
    id: '42',
    name: 'Example Source',
    lang: 'en',
    version: '1.0.0',
    repoUrl: REPO,
    codeUrl: 'https://repo.test/example.js',
    iconUrl: '',
    isNsfw: false,
    isMetadataCapable: true,
    ...overrides
  };
}

function catalogue(sources = [source()], skipped = []) {
  return { repoUrl: REPO, sources, skipped };
}

describe('ExtensionManager', () => {
  beforeEach(() => {
    window.localStorage.clear();
    fetchRepository.mockReset();
  });

  it('shows nothing but the form before a repository is added', () => {
    render(<ExtensionManager />);
    expect(screen.getByText('No repositories yet.')).toBeInTheDocument();
  });

  it('validates a repository before storing it', async () => {
    fetchRepository.mockRejectedValue(new Error('Repository index is not valid JSON'));
    render(<ExtensionManager />);

    await userEvent.type(screen.getByLabelText(/Repository URL/i), REPO);
    await userEvent.click(screen.getByRole('button', { name: /Add repository/i }));

    expect(await screen.findByText(/not valid JSON/)).toBeInTheDocument();
    // The point of validating first: a typo leaves no broken row behind.
    expect(storage.getRepositories()).toEqual([]);
  });

  it('adds a working repository and lists its sources', async () => {
    fetchRepository.mockResolvedValue(catalogue());
    render(<ExtensionManager />);

    await userEvent.type(screen.getByLabelText(/Repository URL/i), REPO);
    await userEvent.click(screen.getByRole('button', { name: /Add repository/i }));

    expect(await screen.findByText('Example Source')).toBeInTheDocument();
    expect(screen.getByText('EN · v1.0.0')).toBeInTheDocument();
    expect(storage.getRepositories()).toEqual([REPO]);
  });

  it('installs a source and then offers to uninstall it', async () => {
    storage.addRepository(REPO);
    fetchRepository.mockResolvedValue(catalogue());
    render(<ExtensionManager />);

    await userEvent.click(await screen.findByRole('button', { name: 'Install' }));

    expect(storage.isInstalled(source().key)).toBe(true);
    expect(screen.getByRole('button', { name: 'Uninstall' })).toBeInTheDocument();
    expect(screen.getByLabelText('Enabled')).toBeChecked();
  });

  it('disables a source without uninstalling it', async () => {
    storage.addRepository(REPO);
    storage.installSource(source());
    fetchRepository.mockResolvedValue(catalogue());
    render(<ExtensionManager />);

    await userEvent.click(await screen.findByLabelText('Enabled'));

    expect(storage.isInstalled(source().key)).toBe(true);
    expect(storage.getEnabledSources()).toHaveLength(0);
  });

  it('offers an update when the repository lists a newer version', async () => {
    storage.addRepository(REPO);
    storage.installSource(source({ version: '1.0.0' }));
    fetchRepository.mockResolvedValue(catalogue([source({ version: '1.1.0' })]));
    render(<ExtensionManager />);

    await userEvent.click(await screen.findByRole('button', { name: /Update to v1.1.0/ }));

    expect(storage.getInstalledSource(source().key).version).toBe('1.1.0');
  });

  it('marks a source that has no catalogue to browse', async () => {
    storage.addRepository(REPO);
    fetchRepository.mockResolvedValue(catalogue([source({ isMetadataCapable: false })]));
    render(<ExtensionManager />);

    expect(await screen.findByText('video only')).toBeInTheDocument();
  });

  it('explains the entries it could not use', async () => {
    storage.addRepository(REPO);
    fetchRepository.mockResolvedValue(
      catalogue([source()], [{ name: 'Some Manga', reason: 'Source is not an anime source' }])
    );
    render(<ExtensionManager />);

    expect(await screen.findByText('1 entries not usable here')).toBeInTheDocument();
    expect(screen.getByText(/Source is not an anime source/)).toBeInTheDocument();
  });

  it('reports a repository that stops responding', async () => {
    storage.addRepository(REPO);
    fetchRepository.mockRejectedValue(new Error('Repository responded 404'));
    render(<ExtensionManager />);

    expect(await screen.findByText('Repository responded 404')).toBeInTheDocument();
  });

  it('removes a repository and the sources installed from it', async () => {
    storage.addRepository(REPO);
    storage.installSource(source());
    fetchRepository.mockResolvedValue(catalogue());
    render(<ExtensionManager />);

    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(storage.getRepositories()).toEqual([]));
    expect(storage.getInstalledSources()).toEqual([]);
  });
});
