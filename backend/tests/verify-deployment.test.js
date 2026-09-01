/**
 * Deciding whether what is deployed is what was merged.
 *
 * The judgement is separated from the network so it can be tested: this is
 * the part that decides "stale" or "current", and it is the part that has
 * to be right. The same error was diagnosed three times because nothing
 * made this call - the repository had the fix and the deployment did not,
 * and a screenshot of the failure looked the same either way.
 */

const { compare } = require('../../scripts/verify-deployment');

describe('comparing what is deployed with what was merged', () => {
  it('is happy when they are the same commit', () => {
    const verdict = compare({
      deployed: 'ce1651fc2997da2294adfd3de80e5ffb47a0fad8',
      expected: 'ce1651fc2997da2294adfd3de80e5ffb47a0fad8'
    });

    expect(verdict.ok).toBe(true);
  });

  // The deployment reports a full sha and a person may pass a short one.
  it('matches a short sha against a full one', () => {
    expect(compare({
      deployed: 'ce1651fc2997da2294adfd3de80e5ffb47a0fad8', expected: 'ce1651f'
    }).ok).toBe(true);
  });

  /*
   * This is the situation that produced the same bug report three times:
   * main was at 51051b8, the fixes were on a branch, and the deployment
   * was serving code that predated all of them.
   */
  it('calls out a deployment that predates the branch', () => {
    const verdict = compare({ deployed: '51051b8', expected: 'ce1651fc2997' });

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/51051b8/);
    expect(verdict.reason).toMatch(/not what was merged/);
  });

  // A deployment old enough to predate build reporting is, by definition,
  // older than anything merged since.
  it.each([['unknown'], ['']])('treats %s as stale rather than as current', (deployed) => {
    const verdict = compare({ deployed, expected: 'ce1651fc' });

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/does not report/);
  });

  // Not knowing is not the same as being current, and must never read as a
  // pass - that is exactly how a stale deployment goes unnoticed.
  it('refuses to pass when it cannot tell what to expect', () => {
    const verdict = compare({ deployed: 'ce1651fc', expected: '' });

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/--expect/);
  });
});
