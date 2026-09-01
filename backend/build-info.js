/**
 * Which build this process is.
 *
 * Read by the health endpoint, and stamped onto every failure report, so a
 * screenshot of an error says which code produced it. The same failure was
 * diagnosed three times because nothing distinguished "the fix does not
 * work" from "this build does not have the fix".
 *
 * The platform sets these at build time from the commit it built. Locally
 * there is no commit, and "unknown" is the honest answer - a local run must
 * not read as a deployment.
 */
function buildInfo() {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA
    || process.env.GIT_COMMIT_SHA
    || '';

  return {
    commit: commit || 'unknown',
    // Short enough to read off a screenshot, long enough to identify.
    shortCommit: commit ? commit.slice(0, 7) : 'unknown',
    branch: process.env.VERCEL_GIT_COMMIT_REF || process.env.GIT_BRANCH || 'unknown',
    builtAt: process.env.VERCEL_DEPLOYMENT_CREATED_AT || null
  };
}

module.exports = { buildInfo };
