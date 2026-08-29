/**
 * Cheerio, exposed to the sandbox as opaque integer handles.
 *
 * The sandbox never receives a cheerio object. It receives a number, and
 * every operation on that number is a call back into here. That is what
 * keeps the boundary honest: a handle carries no prototype chain, so there
 * is nothing on it to walk back out through.
 */

const cheerio = require('cheerio');

const MAX_HANDLES = 20000;

/**
 * A per-run table of parsed documents and selected nodes.
 *
 * One store lives for the duration of a single extension call and is dropped
 * afterwards, so a source cannot leak nodes between invocations and cannot
 * grow the table without bound.
 */
class HtmlStore {
  constructor() {
    this.handles = new Map();
    this.nextId = 1;
  }

  /** @returns {number} a handle for {root, node} */
  store(entry) {
    if (this.handles.size >= MAX_HANDLES) {
      throw new Error('Too many DOM handles held at once');
    }
    const id = this.nextId;
    this.nextId += 1;
    this.handles.set(id, entry);
    return id;
  }

  get(handle) {
    const entry = this.handles.get(Number(handle));
    if (!entry) throw new Error(`Unknown DOM handle: ${handle}`);
    return entry;
  }

  /** Parses a document and returns a handle to its root. */
  parse(html) {
    const $ = cheerio.load(String(html ?? ''));
    return this.store({ $, node: $.root() });
  }

  /** Parses a detached fragment, for sources that build markup themselves. */
  parseFragment(html) {
    const $ = cheerio.load(String(html ?? ''), null, false);
    return this.store({ $, node: $.root() });
  }

  select(handle, selector) {
    const { $, node } = this.get(handle);
    const found = node.find(String(selector));
    return found.toArray().map((el) => this.store({ $, node: $(el) }));
  }

  selectFirst(handle, selector) {
    const { $, node } = this.get(handle);
    const found = node.find(String(selector)).first();
    if (found.length === 0) return null;
    return this.store({ $, node: found });
  }

  attr(handle, name) {
    const { node } = this.get(handle);
    const value = node.attr(String(name));
    return value === undefined ? null : value;
  }

  /** Every attribute of the node, for sources that iterate data-* keys. */
  attrs(handle) {
    const { node } = this.get(handle);
    const el = node.get(0);
    return el && el.attribs ? { ...el.attribs } : {};
  }

  text(handle) {
    return this.get(handle).node.text();
  }

  /** Inner HTML, matching Jsoup's html() rather than the outer markup. */
  html(handle) {
    const { node } = this.get(handle);
    return node.html() ?? '';
  }

  outerHtml(handle) {
    const { $, node } = this.get(handle);
    return $.html(node);
  }

  parent(handle) {
    const { $, node } = this.get(handle);
    const found = node.parent();
    if (found.length === 0) return null;
    return this.store({ $, node: found });
  }

  children(handle) {
    const { $, node } = this.get(handle);
    return node.children().toArray().map((el) => this.store({ $, node: $(el) }));
  }

  nextElementSibling(handle) {
    const { $, node } = this.get(handle);
    const found = node.next();
    if (found.length === 0) return null;
    return this.store({ $, node: found });
  }

  previousElementSibling(handle) {
    const { $, node } = this.get(handle);
    const found = node.prev();
    if (found.length === 0) return null;
    return this.store({ $, node: found });
  }

  /** The tag name, lowercased, or null for a document root. */
  tagName(handle) {
    const el = this.get(handle).node.get(0);
    return el && el.tagName ? String(el.tagName).toLowerCase() : null;
  }

  dispose() {
    this.handles.clear();
  }
}

module.exports = { HtmlStore, MAX_HANDLES };
