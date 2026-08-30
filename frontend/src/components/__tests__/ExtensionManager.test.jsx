/**
 * The manager is where a user meets a repository for the first time, so
 * these tests cover what they see when one is fine, when it is broken, and
 * when it lists things Animiru cannot use.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ExtensionManager from '../ExtensionManager';
import { fetchRepository } from '../../services/extensions/client';
import * as storage from '../../services/extensions/storage';

jest.mock('../../services/extensions/client', () => ({ fetchRepository: jest.fn() }));

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

  describe('the installed panel', () => {
    it('says plainly when nothing is installed', () => {
      render(<ExtensionManager />);
      expect(screen.getByText(/Nothing installed yet/)).toBeInTheDocument();
    });

    it('lists what is installed with its language and version', () => {
      storage.installSource(source({ lang: 'en', version: '1.2.0' }));
      render(<ExtensionManager />);

      expect(screen.getByText('EN · v1.2.0')).toBeInTheDocument();
    });

    it('counts them, so the answer needs no scrolling', () => {
      storage.installSource(source({ key: 'a', name: 'A' }));
      storage.installSource(source({ key: 'b', name: 'B' }));
      render(<ExtensionManager />);

      const panel = screen.getByText('Installed').closest('h2');
      expect(panel).toHaveTextContent('2');
    });

    it('removes one from the panel itself', async () => {
      storage.installSource(source());
      fetchRepository.mockResolvedValue(catalogue());
      render(<ExtensionManager />);

      await userEvent.click(screen.getByRole('button', { name: 'Remove' }));

      expect(storage.getInstalledSources()).toEqual([]);
      expect(await screen.findByText(/Nothing installed yet/)).toBeInTheDocument();
    });

    it('disables one without removing it', async () => {
      storage.installSource(source());
      render(<ExtensionManager />);

      await userEvent.click(screen.getAllByLabelText('Enabled')[0]);

      expect(storage.isInstalled(source().key)).toBe(true);
      expect(storage.getEnabledSources()).toHaveLength(0);
    });
  });

  describe('one-tap repositories', () => {
    it('offers the known repositories without typing a URL', () => {
      render(<ExtensionManager />);

      expect(screen.getByText('Animiru sources')).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'Add' }).length).toBeGreaterThan(0);
    });

    it('marks a repository that holds no anime, rather than letting it look broken', () => {
      render(<ExtensionManager />);
      expect(screen.getByText('no anime')).toBeInTheDocument();
    });

    it('adds one on a single tap', async () => {
      fetchRepository.mockResolvedValue(catalogue());
      render(<ExtensionManager />);

      await userEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]);

      expect(storage.getRepositories()).toEqual([
        'https://raw.githubusercontent.com/perezfiles01-droid/animiru/main/extensions/index.json'
      ]);
    });

    it('shows one as added rather than offering it twice', async () => {
      fetchRepository.mockResolvedValue(catalogue());
      render(<ExtensionManager />);
      await userEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]);

      expect(await screen.findByRole('button', { name: 'Added' })).toBeDisabled();
    });

    it('does not store one that fails to answer', async () => {
      fetchRepository.mockRejectedValue(new Error('Repository responded 404'));
      render(<ExtensionManager />);

      await userEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]);

      expect(await screen.findByText('Repository responded 404')).toBeInTheDocument();
      expect(storage.getRepositories()).toEqual([]);
    });
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

  it('installs a source, and then says so rather than offering it again', async () => {
    storage.addRepository(REPO);
    fetchRepository.mockResolvedValue(catalogue());
    render(<ExtensionManager />);

    await userEvent.click(await screen.findByRole('button', { name: 'Install' }));

    expect(storage.isInstalled(source().key)).toBe(true);
    expect(screen.getByText('Already installed')).toBeInTheDocument();
    // Enabling and removing live in the Installed panel, not here - the same
    // action offered in two places is how two buttons ended up labelled
    // "Remove" while doing different things.
    expect(screen.queryByRole('button', { name: 'Uninstall' })).not.toBeInTheDocument();
  });

  it('removes a repository under a name that says what it removes', async () => {
    storage.addRepository(REPO);
    storage.installSource(source());
    fetchRepository.mockResolvedValue(catalogue());
    render(<ExtensionManager />);

    expect(await screen.findByRole('button', { name: 'Remove repository' }))
      .toBeInTheDocument();
    // The source's own Remove is a different action in a different panel.
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
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

    await userEvent.click(await screen.findByRole('button', { name: 'Remove repository' }));

    await waitFor(() => expect(storage.getRepositories()).toEqual([]));
    expect(storage.getInstalledSources()).toEqual([]);
  });
});
