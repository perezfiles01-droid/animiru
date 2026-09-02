/**
 * The health endpoint has to say which build is answering.
 *
 * This exists because of a failure that repeated three times: a fix was
 * written, tested, pushed and reported, and the app went on showing the
 * error - because the branch had never been merged and no build had ever
 * contained the fix. Nothing in the API could tell "the fix is broken"
 * apart from "the fix is not deployed", so the same cause was diagnosed
 * three times from screenshots that could not identify themselves.
 *
 * A build that does not report its commit puts us back there, so it fails
 * here instead.
 */

const express = require('express');
const request = require('supertest');
const health = require('../routes/health');

const app = express();
app.use('/api/health', health);

const GIT_ENV = [
  'VERCEL_GIT_COMMIT_SHA', 'GIT_COMMIT_SHA',
  'VERCEL_GIT_COMMIT_REF', 'GIT_BRANCH',
  'VERCEL_DEPLOYMENT_CREATED_AT'
];

const saved = {};
beforeEach(() => {
  for (const key of GIT_ENV) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});
afterEach(() => {
  for (const key of GIT_ENV) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('what the health endpoint reports', () => {
  it('still answers that it is healthy', async () => {
    const { body } = await request(app).get('/api/health').expect(200);
    expect(body.status).toBe('healthy');
  });

  it('reports the commit it was built from', async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = 'ce1651fc2997da2294adfd3de80e5ffb47a0fad8';
    process.env.VERCEL_GIT_COMMIT_REF = 'main';

    const { body } = await request(app).get('/api/health').expect(200);

    expect(body.build.commit).toBe('ce1651fc2997da2294adfd3de80e5ffb47a0fad8');
    expect(body.build.branch).toBe('main');
  });

  // Short enough to read out of a screenshot, long enough to identify.
  it('reports a short commit that can be read off a screen', async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = 'ce1651fc2997da2294adfd3de80e5ffb47a0fad8';

    const { body } = await request(app).get('/api/health').expect(200);

    expect(body.build.shortCommit).toBe('ce1651f');
    expect(body.build.shortCommit).toHaveLength(7);
  });

  // Running locally there is no commit. Saying "unknown" is the honest
  // answer; inventing one would make a local run look like a deployment.
  it('says unknown rather than guessing when there is no commit', async () => {
    const { body } = await request(app).get('/api/health').expect(200);

    expect(body.build.commit).toBe('unknown');
    expect(body.build.shortCommit).toBe('unknown');
  });

  it('is a router, because server.js hands it to app.use', () => {
    expect(typeof health).toBe('function');
  });
});
