/**
 * What a vendored copy has to carry, and where it must not reach.
 *
 * vendor/ holds code copied in from other projects. A copy like that goes
 * wrong in two quiet ways, and neither announces itself:
 *
 * The licence gets left behind. Every project in vendor/ arrives under
 * somebody else's terms - snitchmd is MIT, which requires the notice travel
 * with the code - and a copy that lost its LICENSE looks exactly like a copy
 * that never needed one.
 *
 * The provenance goes missing. Without the upstream URL and the exact commit,
 * nobody can tell whether the copy is current, what it was forked from, or
 * whether a local edit has been made to it. It becomes unmaintainable the day
 * the person who copied it stops remembering.
 *
 * And the third: vendored code is not this project's code. It must not be
 * pulled into the builds, lint runs, or deploys that own backend/ and
 * frontend/ - a Dockerfile and a Rust crate under vendor/ have no business in
 * a Vercel function or an APK.
 *
 * Every directory under vendor/ is enumerated at runtime, so a project
 * vendored next year is checked without anyone remembering to add it here -
 * and it is the one most likely to be missing something, because whoever adds
 * it will be newest to the convention.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const VENDOR_DIR = path.join(REPO_ROOT, 'vendor');

const vendored = fs.existsSync(VENDOR_DIR)
  ? fs.readdirSync(VENDOR_DIR).filter(
    (name) => fs.statSync(path.join(VENDOR_DIR, name)).isDirectory()
  )
  : [];

describe('every vendored project', () => {
  it('is enumerated from the directory, so a later one is covered too', () => {
    expect(vendored.length).toBeGreaterThan(0);
  });

  describe.each(vendored)('%s', (name) => {
    const dir = path.join(VENDOR_DIR, name);

    // MIT and the rest require the notice travel with the code. Dropping it
    // is a licensing problem, not an untidiness one.
    it('keeps the licence it arrived under', () => {
      expect(fs.existsSync(path.join(dir, 'LICENSE'))).toBe(true);
    });

    it('records where it came from', () => {
      const provenance = path.join(dir, 'VENDORED.md');
      expect(fs.existsSync(provenance)).toBe(true);

      const text = fs.readFileSync(provenance, 'utf8');
      expect(text).toMatch(/https?:\/\/\S+/);
    });

    // A branch name moves and a tag can be repointed. Only a full SHA says
    // exactly which copy this is.
    it('pins an exact commit, not a branch', () => {
      const text = fs.readFileSync(path.join(dir, 'VENDORED.md'), 'utf8');

      expect(text).toMatch(/\b[0-9a-f]{40}\b/);
    });
  });
});

/**
 * The reason a new top-level folder was safe to add in the first place.
 *
 * Nothing in this repository globs widely enough to swallow vendor/: the
 * build workflow works inside backend/, frontend/ and mobile/android; the
 * extension index workflow is path-filtered; Vercel builds from
 * backend/vercel.json. That was checked before the copy landed - and a
 * checked fact stops being true the moment someone edits a workflow, which
 * is what this asserts.
 */
describe('the repository build, which vendored code must stay out of', () => {
  const workflows = path.join(REPO_ROOT, '.github', 'workflows');

  const files = fs.existsSync(workflows)
    ? fs.readdirSync(workflows).filter((name) => /\.ya?ml$/.test(name))
    : [];

  it('has workflows to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s does not reach into vendor/', (name) => {
    const text = fs.readFileSync(path.join(workflows, name), 'utf8');

    expect(text).not.toMatch(/vendor\//);
  });

  // A Dockerfile and a Rust crate under vendor/ must not be mistaken for
  // something the deployed function needs.
  it('the deployed backend does not depend on anything vendored', () => {
    const backend = path.join(REPO_ROOT, 'backend');

    const sources = fs.readdirSync(backend, { recursive: true })
      .filter((name) => typeof name === 'string' && name.endsWith('.js'))
      .filter((name) => !name.startsWith('tests'))
      .filter((name) => !name.includes('node_modules'));

    for (const relative of sources) {
      const text = fs.readFileSync(path.join(backend, relative), 'utf8');
      expect({ file: relative, requiresVendor: /require\([^)]*vendor\//.test(text) })
        .toEqual({ file: relative, requiresVendor: false });
    }
  });
});
