/**
 * The folder's README is what GitHub shows when the folder is opened, so it
 * carries the URL to paste and the list of what is in there. Both are
 * generated: a hand-written list goes stale the first time a source is added
 * and then quietly misleads.
 */

const fs = require('fs');
const path = require('path');
const { render, table, siteLink, languageOf, MARKER } = require('../../scripts/generate-extension-readme');
const { build } = require('../../scripts/generate-extension-index');

const README = path.join(__dirname, '..', '..', 'extensions', 'README.md');
const text = () => fs.readFileSync(README, 'utf8');

describe('the extensions README', () => {
  it('is in step with the sources on disk', () => {
    expect(text()).toBe(render(text(), build()));
  });

  // The whole point of the folder: one URL that lists everything in it.
  it('carries the repository URL to paste', () => {
    expect(text()).toContain(
      'https://raw.githubusercontent.com/perezfiles01-droid/animiru/main/extensions/index.json'
    );
  });

  it('lists the extensions currently in the folder', () => {
    expect(text()).toMatch(/\| Internet Archive \| English \| 1\.0\.0 \|/);
  });

  it('says index.json is generated, since editing it by hand is lost work', () => {
    expect(text()).toMatch(/do not edit it by hand/i);
  });
});

describe('rebuilding it', () => {
  const prose = '# Extensions\n\nSome hand-written prose.\n';

  it('keeps the prose and replaces only the generated part', () => {
    const first = render(prose, [
      { name: 'A', lang: 'en', version: '1.0.0', baseUrl: 'https://a.test' }
    ]);
    const second = render(first, [
      { name: 'A', lang: 'en', version: '1.0.0', baseUrl: 'https://a.test' },
      { name: 'B', lang: 'ja', version: '2.1.0', baseUrl: 'https://b.test' }
    ]);

    expect(second).toContain('Some hand-written prose.');
    expect(second).toContain('| B | Japanese | 2.1.0 |');
    // Rebuilt, not appended - one marker however many times it runs.
    expect(second.split(MARKER)).toHaveLength(2);
    expect(second).toContain('2 extensions.');
  });

  it('does not change when nothing has changed', () => {
    const entries = [{ name: 'A', lang: 'en', version: '1.0.0', baseUrl: 'https://a.test' }];
    expect(render(render(prose, entries), entries)).toBe(render(prose, entries));
  });

  it('says what to do when the folder is empty rather than showing a bare table', () => {
    expect(table([])).toMatch(/Drop a `\.js` file/);
  });

  it('counts one extension in the singular', () => {
    expect(table([{ name: 'A', lang: 'en', version: '1', baseUrl: 'https://a.test' }]))
      .toContain('1 extension.');
  });

  it.each([['en', 'English'], ['ja', 'Japanese'], ['all', 'All'], ['pt-br', 'PT-BR']])(
    'names the %s language', (code, expected) => expect(languageOf(code)).toBe(expected)
  );

  it('links the site without the scheme, and copes with a source that names none', () => {
    expect(siteLink('https://a.test/')).toBe('[a.test](https://a.test/)');
    expect(siteLink('')).toBe('—');
  });
});
