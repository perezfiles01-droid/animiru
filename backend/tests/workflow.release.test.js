/**
 * A merge to main has to produce an installable build.
 *
 * The app asks GitHub for the newest release and compares it against the
 * version compiled into itself. A build that is never released is a build
 * no user is ever offered - and that is exactly what happened: the release
 * job was gated to workflow_dispatch, so merging to main built an APK,
 * uploaded it as an artifact and published nothing. The backend carried the
 * fixes, the app reported itself up to date, and the two were both correct.
 *
 * Nothing about that is visible in a passing CI run: the job reports
 * "skipped", which reads like a job that had nothing to do.
 */

const fs = require('fs');
const path = require('path');

const WORKFLOW = path.join(__dirname, '..', '..', '.github', 'workflows', 'build-deploy.yml');
const workflow = fs.readFileSync(WORKFLOW, 'utf8');

/** The block of one top-level job, up to the next job at the same indent. */
function job(name) {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  if (start === -1) return '';

  const after = workflow.slice(start + 1);
  const next = after.slice(1).search(/\n {2}[a-z][\w-]*:\n/);
  return next === -1 ? after : after.slice(0, next + 1);
}

describe('publishing a release', () => {
  it('has a release job at all', () => {
    expect(job('release')).not.toBe('');
  });

  /*
   * The condition this asserts is the whole point. Gating the release on
   * workflow_dispatch alone means every merge silently publishes nothing.
   */
  it('runs when a merge lands on main, not only when triggered by hand', () => {
    const condition = job('release').match(/if:[\s\S]*?\n\s{4}[a-z]/i)[0];

    expect(condition).toMatch(/refs\/heads\/main/);
    expect(condition).toMatch(/push/);
  });

  it('still allows publishing by hand', () => {
    expect(job('release')).toMatch(/workflow_dispatch/);
  });

  it('waits for the build, so a release always carries an APK', () => {
    expect(job('release')).toMatch(/needs:\s*build/);
  });
});

/**
 * The tag and the compiled version have to be the same number.
 *
 * The app compares the version compiled into itself against the newest
 * release tag. If those are derived differently, it either never offers an
 * update or offers one for ever, and both look like a broken update check
 * rather than a mismatched build.
 */
describe('the version the app compares against', () => {
  it('compiles the run number into the app', () => {
    expect(workflow).toMatch(/REACT_APP_VERSION:\s*v1\.0\.\$\{\{\s*github\.run_number\s*\}\}/);
  });

  it('tags the release with that same run number', () => {
    expect(job('release')).toMatch(/gh release create\s+"v1\.0\.\$\{\{\s*github\.run_number\s*\}\}"/);
  });
});
