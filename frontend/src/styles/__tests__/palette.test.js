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
  /**
   * These were once filled with --highlight to fix exactly this: outlined,
   * they had been navy text on navy and were invisible. They are outlined
   * again now, deliberately - but on --surface with --highlight text, so the
   * legibility that filling them bought is kept while they stop competing
   * with the Watch button. The rule being pinned is that they are readable,
   * not which of the two treatments achieves it.
   */
  it('keeps the Recommendations and Watch order buttons legible', () => {
    const css = read('Metadata.css');
    const link = css.match(/\.metadata-link\s*\{([^}]*)\}/s)[1];

    expect(link).toMatch(/background:\s*var\(--surface\)/);
    expect(link).toMatch(/color:\s*var\(--highlight\)/);
    // The failure this whole block exists for: navy on navy.
    expect(link).not.toMatch(/color:\s*var\(--accent\)/);
  });

  it('fills the percentage badge rather than washing it', () => {
    const css = read('Metadata.css');
    expect(css).toMatch(/\.recommendation-percent\s*\{[^}]*background:\s*var\(--highlight\)/s);
    expect(css).toMatch(/\.recommendation-percent\s*\{[^}]*color:\s*#fff/s);
  });
});

/**
 * Rules whose failure is only visible on a phone.
 *
 * jsdom does not lay anything out, so a component test cannot see that a row
 * wrapped onto four lines. These read the stylesheet instead, which is the
 * only check available short of a device.
 */
describe('the source row', () => {
  const fs = require('fs');
  const path = require('path');

  const CSS = fs.readFileSync(
    path.join(__dirname, '..', 'Extensions.css'), 'utf8'
  );

  /** The body of one rule, by selector. */
  function rule(selector) {
    const match = CSS.match(
      new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)
    );
    if (!match) throw new Error(`No rule for ${selector}`);
    return match[1];
  }

  // Eight sources wrapped onto four lines and pushed the search box and the
  // catalogue off the top of the screen.
  it('is one row that scrolls, not a block that grows', () => {
    const body = rule('.ext-source-tabs');

    expect(body).toMatch(/flex-wrap:\s*nowrap/);
    expect(body).toMatch(/overflow-x:\s*auto/);
  });

  // A flex item shrinks to fit by default, so without this the tabs squeeze
  // into the row and truncate instead of scrolling.
  it('keeps each tab at its natural width', () => {
    const body = rule('.ext-source-tabs .ext-source-tab');

    expect(body).toMatch(/flex:\s*0\s+0\s+auto/);
    expect(body).toMatch(/white-space:\s*nowrap/);
  });

  // A horizontal strip that captures a vertical swipe makes the page feel
  // stuck, and a visible scrollbar over eight tabs is noise.
  it('does not steal the page scroll, and hides its own bar', () => {
    expect(rule('.ext-source-tabs')).toMatch(/overscroll-behavior-x:\s*contain/);
    expect(CSS).toMatch(/\.ext-source-tabs::-webkit-scrollbar\s*\{[^}]*display:\s*none/);
  });
});


/**
 * The two links under Watch.
 *
 * They were filled with --highlight, identical to the Watch button, so all
 * three read as equally important - and they were stacked, making two
 * full-width pink slabs the loudest thing on the page.
 */
describe('the secondary actions on a detail page', () => {
  const fs = require('fs');
  const path = require('path');

  const CSS = fs.readFileSync(path.join(__dirname, '..', 'Metadata.css'), 'utf8');

  function rule(selector) {
    const match = CSS.match(
      new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`)
    );
    if (!match) throw new Error(`No rule for ${selector}`);
    return match[1];
  }

  it('sits them side by side in one row', () => {
    const body = rule('.details-metadata-links');

    expect(body).toMatch(/flex-direction:\s*row/);
    expect(rule('.metadata-link')).toMatch(/flex:\s*1\s+1\s+0/);
  });

  it('does not fill them with the primary colour', () => {
    const body = rule('.metadata-link');

    expect(body).not.toMatch(/background:\s*var\(--highlight\)/);
    expect(body).toMatch(/background:\s*var\(--surface\)/);
  });

  // --accent is a background navy; as text on this page it is invisible.
  it('gives them a text colour that reads on the page', () => {
    expect(rule('.metadata-link')).toMatch(/color:\s*var\(--highlight\)/);
  });

  // Half-width buttons hold two words; without this a long label overflows
  // its pill rather than wrapping inside it.
  it('lets a label wrap rather than overflow', () => {
    expect(rule('.metadata-link')).toMatch(/min-width:\s*0/);
  });
});
