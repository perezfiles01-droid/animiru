/**
 * Static checks over every bundled source.
 *
 * These exist because of failures that reached a device. A source can be
 * syntactically perfect, load cleanly, and still be missing something the
 * app needs - and the app has no way to tell until someone opens a title
 * and finds it called "Untitled".
 *
 * Nothing here runs a source or touches the network. It reads the files, so
 * it is cheap enough to run on every push and catches a whole class of
 * mistake at the moment a source is added rather than on a phone weeks
 * later.
 */

const fs = require('fs');
const path = require('path');
const { extractMetadata } = require('../extensions');

const SOURCES_DIR = path.join(__dirname, '..', '..', 'extensions', 'sources');

const sources = fs.readdirSync(SOURCES_DIR)
  .filter((file) => file.endsWith('.js'))
  .map((file) => ({ file, code: fs.readFileSync(path.join(SOURCES_DIR, file), 'utf8') }));

describe('every bundled source', () => {
  it('there is at least one to check', () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it.each(sources.map((s) => [s.file]))('%s parses as JavaScript', (file) => {
    const { code } = sources.find((s) => s.file === file);
    expect(() => new (require('vm').Script)(code)).not.toThrow();
  });

  it.each(sources.map((s) => [s.file]))('%s declares what the index needs', (file) => {
    const { code } = sources.find((s) => s.file === file);
    const [declared] = extractMetadata(code);

    expect(declared).toBeTruthy();
    expect(typeof declared.name).toBe('string');
    expect(Number.isInteger(declared.id)).toBe(true);
    expect(typeof declared.baseUrl).toBe('string');
    expect(typeof declared.version).toBe('string');
  });

  /*
   * There is deliberately no static check that getDetail names its title.
   *
   * One was written for exactly the AnimeParadise bug and did not catch it:
   * that method pushes chapters as { name: epName, ... }, so an episode's
   * name satisfied any pattern looking for a name inside the method. The
   * check passed on the bug it existed for, which is worse than no check -
   * it would have waved the next one through too.
   *
   * Telling a title's name from an episode's needs to know which object is
   * returned, and these are fifteen hand-written scrapers with no shared
   * shape. So the protection is in the app instead, where it can be tested
   * properly: the card carries the title it already knows into the detail
   * link, and it is used whenever getDetail returns none. See "a source
   * that returns no title" in frontend Details tests.
   */

  /**
   * The second argument to Client.get and Client.head IS the headers.
   * Passing { headers: {...} } sends one header literally called "headers"
   * and none of the ones intended - which is how Re:ANIME shipped, and the
   * kind of mistake that produces a site refusing a request for no visible
   * reason.
   */
  it.each(sources.map((s) => [s.file]))('%s passes headers as headers', (file) => {
    const { code } = sources.find((s) => s.file === file);

    expect(code).not.toMatch(/\.(get|head)\s*\([^,)]+,\s*\{\s*headers\s*:/);
  });
});

/**
 * Ids identify an installed source. Two sources sharing one overwrite each
 * other, and the folder shows one where it holds two - which is how
 * Re:ANIME arrived, carrying AnimePahe's id.
 */
describe('the folder as a whole', () => {
  it('gives every source a different id', () => {
    const byId = new Map();

    for (const { file, code } of sources) {
      const [declared] = extractMetadata(code) || [];
      if (!declared) continue;

      const seen = byId.get(declared.id);
      expect(seen === undefined || seen === file)
        .toBe(true, `id ${declared.id} is used by both ${seen} and ${file}`);
      byId.set(declared.id, file);
    }

    expect(byId.size).toBe(sources.length);
  });
});
