/**
 * The two metadata buttons and the recommendation percentage rendered as
 * dark navy text on a dark navy page - invisible.
 *
 * The cause was a token, not a colour choice: rules asked for
 * `var(--accent, #8ea2d8)` expecting a light blue fallback, but --accent
 * exists and is #0f3460, a background colour, so the fallback never
 * applied. These pin the tokens so the same mistake cannot return silently.
 */

const fs = require('fs');
const path = require('path');

const styles = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(styles, name), 'utf8');
const sheets = () => fs.readdirSync(styles).filter((f) => f.endsWith('.css'));

describe('the theme tokens', () => {
  it('defines every token the newer screens use', () => {
    const app = read('App.css');
    for (const token of ['--muted', '--surface', '--accent-text', '--highlight']) {
      expect(app).toContain(`${token}:`);
    }
  });

  // Text painted in this would be navy on navy.
  it('keeps --accent as a background colour, not a text one', () => {
    for (const sheet of sheets()) {
      // Anchored: "background-color" contains "color", and matching that
      // would flag every legitimate use of this token.
      expect(read(sheet)).not.toMatch(/(^|[;{\s])color:\s*var\(--accent\s*[,)]/m);
    }
  });

  it('leaves no rule depending on a fallback for a token that exists', () => {
    for (const sheet of sheets()) {
      expect(read(sheet)).not.toMatch(/var\(--(accent|muted|surface|border),/);
    }
  });
});

describe('the controls that were invisible', () => {
  it('fills the Recommendations and Watch order buttons', () => {
    const css = read('Metadata.css');
    expect(css).toMatch(/\.metadata-link\s*\{[^}]*background:\s*var\(--highlight\)/s);
    expect(css).toMatch(/\.metadata-link\s*\{[^}]*color:\s*#fff/s);
  });

  it('fills the percentage badge rather than washing it', () => {
    const css = read('Metadata.css');
    expect(css).toMatch(/\.recommendation-percent\s*\{[^}]*background:\s*var\(--highlight\)/s);
    expect(css).toMatch(/\.recommendation-percent\s*\{[^}]*color:\s*#fff/s);
  });
});
