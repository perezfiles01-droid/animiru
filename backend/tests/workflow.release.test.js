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

/**
 * The APK has to carry the same version as everything else.
 *
 * Three places stamp a version: the release tag, the version compiled into
 * the web bundle, and the Android package metadata. The first two came from
 * the run number; the third was hardcoded to versionCode 1 / 1.0.0, so every
 * APK ever built claimed to be the same version as every other.
 *
 * Android reads an install whose version code has not increased as
 * reinstalling rather than updating, and several OEM installers refuse it -
 * leaving uninstall-first as the only way through, which deletes the app
 * storage holding the library, sources and settings. Nothing in a green
 * build showed this: the workflow passed, the release published, and the
 * Update screen correctly offered a version the APK did not carry.
 */
const GRADLE = path.join(__dirname, '..', '..', 'mobile', 'android', 'app', 'build.gradle');
const gradle = fs.readFileSync(GRADLE, 'utf8');

describe('the version the APK carries', () => {
  it('reads both versions from the properties the build supplies', () => {
    expect(gradle).toMatch(/project\.findProperty\(\s*'animiruVersionCode'\s*\)/);
    expect(gradle).toMatch(/project\.findProperty\(\s*'animiruVersionName'\s*\)/);
  });

  // The hardcoded pair is the bug itself, and the shape to keep out.
  it('does not hardcode either of them', () => {
    expect(gradle).not.toMatch(/versionCode\s+\d+\s*$/m);
    expect(gradle).not.toMatch(/versionName\s+["'][\d.]+["']\s*$/m);
  });

  /*
   * Read into locals before the android block, not written inline in it.
   * Groovy parses `versionCode (expr) as Integer` as a call to versionCode
   * followed by a cast of its result, so the DSL received the wrong value
   * and the build failed with "Value is null" - green tests, red CI.
   */
  it('assigns the DSL a plain value, with no cast to misparse', () => {
    // Comments explain the misparse, so searching the raw file finds the
    // explanation rather than the code. Read what executes.
    const code = gradle
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');

    expect(code).toMatch(/versionCode\s+animiruVersionCode\s*$/m);
    expect(code).toMatch(/versionName\s+animiruVersionName\s*$/m);
    expect(code).not.toMatch(/versionCode[^\n]*\bas\s+Integer/);
  });

  it('is passed to every gradle build the workflow runs', () => {
    const builds = workflow.match(/\.\/gradlew[^\n]*assemble\w+[\s\S]*?(?=\n\s*-\s|\n\n)/g) || [];

    // Debug and release both ship: the debug APK is what the signature
    // check reads, and the release APK is what users install.
    expect(builds.length).toBeGreaterThanOrEqual(2);
    for (const build of builds) {
      expect(build).toMatch(/-PanimiruVersionCode=\$\{\{\s*github\.run_number\s*\}\}/);
      expect(build).toMatch(/-PanimiruVersionName=1\.0\.\$\{\{\s*github\.run_number\s*\}\}/);
    }
  });

  // The whole point: one run number, three stamps, all agreeing. A release
  // tagged v1.0.120 containing an APK that calls itself 1.0.0 is the bug.
  it('comes from the same run number as the tag and the bundle', () => {
    const fromRunNumber = (text) => /\$\{\{\s*github\.run_number\s*\}\}/.test(text);

    expect(fromRunNumber(workflow.match(/REACT_APP_VERSION:[^\n]*/)[0])).toBe(true);
    expect(fromRunNumber(job('release').match(/gh release create[^\n]*/)[0])).toBe(true);
    expect(fromRunNumber(workflow.match(/-PanimiruVersionName[^\n]*/)[0])).toBe(true);
  });
});
