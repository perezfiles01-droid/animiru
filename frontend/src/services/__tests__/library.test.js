/**
 * The library is stored locally: Animiru has no accounts, so there is
 * nowhere else for it to live.
 */

import {
  getLibrary, isInLibrary, addToLibrary, removeFromLibrary,
  toggleLibrary, clearLibrary, libraryKey, LIBRARY_STORAGE_KEY
} from '../library';

const item = (overrides = {}) => ({
  id: '/anime/frieren',
  providerId: 'extension:a',
  providerName: 'AniNeko',
  title: 'Frieren',
  poster: 'https://i.test/f.jpg',
  ...overrides
});

describe('the library', () => {
  beforeEach(() => window.localStorage.clear());

  it('starts empty', () => {
    expect(getLibrary()).toEqual([]);
  });

  it('saves a title and reports it saved', () => {
    addToLibrary(item());

    expect(isInLibrary(item())).toBe(true);
    expect(getLibrary()[0]).toMatchObject({
      id: '/anime/frieren', title: 'Frieren', providerName: 'AniNeko'
    });
  });

  // The library has to draw without asking a source, or an uninstalled or
  // failing source would blank a shelf the user had built.
  it('keeps the title and poster rather than a reference', () => {
    addToLibrary(item());
    const [saved] = getLibrary();

    expect(saved.title).toBe('Frieren');
    expect(saved.poster).toBe('https://i.test/f.jpg');
  });

  it('takes a title back out', () => {
    addToLibrary(item());
    removeFromLibrary(item());

    expect(isInLibrary(item())).toBe(false);
    expect(getLibrary()).toEqual([]);
  });

  it('toggles, reporting the state it ends in', () => {
    expect(toggleLibrary(item())).toBe(true);
    expect(toggleLibrary(item())).toBe(false);
  });

  it('does not save the same title twice', () => {
    addToLibrary(item());
    addToLibrary(item());

    expect(getLibrary()).toHaveLength(1);
  });

  // Two sources play from different places and list different episodes, so
  // collapsing them would make "watch" ambiguous.
  it('treats the same show from two sources as two entries', () => {
    addToLibrary(item());
    addToLibrary(item({ providerId: 'extension:b', providerName: 'AnimePahe' }));

    expect(getLibrary()).toHaveLength(2);
  });

  it('puts the newest first', () => {
    addToLibrary(item({ id: '/one', title: 'One' }));
    addToLibrary(item({ id: '/two', title: 'Two' }));

    expect(getLibrary().map((entry) => entry.title)).toEqual(['Two', 'One']);
  });

  it('refuses an item with nothing to identify it', () => {
    addToLibrary({ title: 'Nameless' });
    expect(getLibrary()).toEqual([]);
  });

  it('empties on request', () => {
    addToLibrary(item());
    clearLibrary();
    expect(getLibrary()).toEqual([]);
  });

  it('keys on the source and the source\'s own id', () => {
    expect(libraryKey(item())).toBe('extension:a:/anime/frieren');
  });

  describe('when localStorage is unavailable', () => {
    // A private window, an embedded webview with site data blocked, or a
    // full quota. It throws rather than returning null.
    const withBrokenStorage = (fn) => {
      const get = jest.spyOn(Storage.prototype, 'getItem')
        .mockImplementation(() => { throw new Error('denied'); });
      const set = jest.spyOn(Storage.prototype, 'setItem')
        .mockImplementation(() => { throw new Error('denied'); });
      try { fn(); } finally { get.mockRestore(); set.mockRestore(); }
    };

    it('reads as empty rather than throwing', () => {
      withBrokenStorage(() => {
        expect(getLibrary()).toEqual([]);
        expect(isInLibrary(item())).toBe(false);
      });
    });

    it('lets a save fail quietly rather than breaking the page', () => {
      withBrokenStorage(() => {
        expect(() => addToLibrary(item())).not.toThrow();
      });
    });
  });

  it('survives a stored value that is not a list', () => {
    window.localStorage.setItem(LIBRARY_STORAGE_KEY, '{"not":"a list"}');
    expect(getLibrary()).toEqual([]);
  });
});
