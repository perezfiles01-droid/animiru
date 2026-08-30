/**
 * These run the extensions the user actually installed, not fixtures written
 * to pass. Every file under fixtures/sources is a real Mangayomi source,
 * copied unmodified, so a failure here means the app is broken for them.
 *
 * The network is stubbed at extensions/http, which is the only door out of
 * the sandbox - so what these assert is the exact bytes a source would have
 * put on the wire.
 */

const fs = require('fs');
const path = require('path');
const { runExtension, extractMetadata } = require('../extensions');
const http = require('../extensions/http');

const SOURCES = path.join(__dirname, 'fixtures', 'sources');

function load(name) {
  return fs.readFileSync(path.join(SOURCES, `${name}.js`), 'utf8');
}

/** The index.json entry the app would pass, taken from the source itself. */
function entry(name) {
  return extractMetadata(load(name))[0];
}

/**
 * Answers every request with `body` and records what was asked for.
 *
 * @returns {{calls: Array}} populated as the extension runs
 */
function stubHttp(body = '<html></html>', status = 200) {
  const calls = [];
  jest.spyOn(http, 'request').mockImplementation(async (options) => {
    calls.push(options);
    return {
      status,
      statusCode: status,
      headers: { 'content-type': 'text/html' },
      body: typeof body === 'function' ? body(options) : body
    };
  });
  return { calls };
}

afterEach(() => jest.restoreAllMocks());

describe('real Mangayomi sources', () => {
  describe.each(['anikoto', 'just4anime', 'miruro'])('%s', (name) => {
    it('declares itself with a baseUrl', () => {
      expect(entry(name)).toMatchObject({ baseUrl: expect.stringMatching(/^https:\/\//) });
    });

    // Every one of these sources is written as
    //   constructor() { super(); this.client = new Client(); }
    // - super() with no arguments. If the runner relied on the constructor
    // to keep the source it was handed, this.source.baseUrl would be
    // undefined and the source would request "undefined/ongoing?page=1",
    // which is what users were seeing.
    it('never builds a request against an undefined baseUrl', async () => {
      const { calls } = stubHttp();
      await runExtension({
        code: load(name), method: 'getPopular', args: [1], source: entry(name)
      });

      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call.url).not.toMatch(/undefined/);
        expect(call.url).toMatch(/^https?:\/\//);
      }
    });
  });
});
