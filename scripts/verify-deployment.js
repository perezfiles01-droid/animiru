#!/usr/bin/env node
/**
 * Is the thing answering requests the thing we just merged?
 *
 * Written after the same failure was diagnosed three times. Each time a fix
 * was pushed to a branch and reported as done; each time the app went on
 * failing, because no build had ever contained it. The repository and the
 * deployment had drifted and nothing said so - a screenshot of a failure
 * looks identical whether the fix is broken or simply absent.
 *
 * This asks the deployment what it was built from and compares it with what
 * the branch says it should be. It exits non-zero when they differ, so it
 * can be believed in CI as well as read by a person.
 *
 * Usage:
 *   node scripts/verify-deployment.js
 *   node scripts/verify-deployment.js --url https://example.vercel.app/api
 *   node scripts/verify-deployment.js --expect <sha>
 */

const https = require('https');
const http = require('http');
const { execSync } = require('child_process');

const DEFAULT_URL = 'https://animiru-livid.vercel.app/api';
const TIMEOUT_MS = 15000;

function argument(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at !== -1 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

/** The commit the deployment ought to be serving. */
function expectedCommit() {
  const given = argument('expect');
  if (given) return given;

  try {
    return execSync('git rev-parse origin/main', { encoding: 'utf8' }).trim();
  } catch (err) {
    return '';
  }
}

function getJson(url) {
  const client = url.startsWith('https:') ? https : http;

  return new Promise((resolve, reject) => {
    const request = client.get(url, { timeout: TIMEOUT_MS }, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error(`${url} answered ${response.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(new Error(`${url} did not answer with JSON`));
        }
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error(`${url} did not answer within ${TIMEOUT_MS}ms`));
    });
    request.on('error', reject);
  });
}

/**
 * What to tell the reader, given what is deployed and what should be.
 *
 * Separated from the fetching so it can be tested without a network: this
 * is the part that decides whether a deployment is stale, and it is the
 * part worth getting right.
 */
function compare({ deployed, expected }) {
  if (!deployed || deployed === 'unknown') {
    return {
      ok: false,
      reason: 'The deployment does not report which commit it was built from. '
        + 'It predates the build reporting, so it certainly predates anything '
        + 'merged since.'
    };
  }

  if (!expected) {
    return {
      ok: false,
      reason: 'Could not work out which commit to expect. Fetch origin, or '
        + 'pass --expect <sha>.'
    };
  }

  if (deployed.slice(0, 7) !== expected.slice(0, 7)) {
    return {
      ok: false,
      reason: `The deployment is serving ${deployed.slice(0, 7)}, but the `
        + `branch is at ${expected.slice(0, 7)}. What is running is not what `
        + 'was merged, so a failure you see may already be fixed in the code.'
    };
  }

  return { ok: true, reason: `The deployment is serving ${deployed.slice(0, 7)}, as expected.` };
}

async function main() {
  const base = argument('url', DEFAULT_URL).replace(/\/+$/, '');
  const expected = expectedCommit();

  let health;
  try {
    health = await getJson(`${base}/health`);
  } catch (err) {
    console.error(`Could not reach ${base}/health: ${err.message}`);
    console.error('Nothing can be said about what is deployed.');
    process.exit(2);
  }

  const deployed = (health.build && health.build.commit) || '';
  const verdict = compare({ deployed, expected });

  console.log(`Deployment: ${base}`);
  console.log(`  serving:  ${deployed || 'unknown'}`);
  console.log(`  expected: ${expected || 'unknown'}`);
  console.log(verdict.ok ? `\nOK. ${verdict.reason}` : `\nSTALE. ${verdict.reason}`);

  process.exit(verdict.ok ? 0 : 1);
}

if (require.main === module) main();

module.exports = { compare };
