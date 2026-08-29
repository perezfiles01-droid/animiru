/**
 * The Mangayomi API surface, pinned.
 *
 * These exist because this was got wrong once, in a way that only showed up
 * on a real source: `Client` was provided as a global object rather than a
 * class, and the DOM accessors were methods rather than properties. Every
 * published source begins with `new Client()`, so the whole runtime was
 * unusable while looking fine against tests written to match it.
 *
 * The shapes here follow Mangayomi's CONTRIBUTING-JS.md and the usage in its
 * published sources, so a failure means real sources will break.
 */

const { runExtension } = require('../extensions');
const http = require('../extensions/http');

function extensionWith(body) {
  return `class DefaultExtension extends MProvider {
    async search(query, page) { ${body} }
  }`;
}

async function run(body, options = {}) {
  const { result } = await runExtension({
    code: extensionWith(body),
    method: 'search',
    args: ['q', 1],
    ...options
  });
  return result;
}

const PAGE = `
  <html><body>
    <div class="grid">
      <a href="/series/one" id="first" class="card">
        <span class="block">Title One</span>
        <img src="/img/one.jpg" data-src="/lazy/one.jpg">
      </a>
      <a href="/series/two" class="card"><span class="block">Title Two</span></a>
    </div>
    <p class="note">after</p>
  </body></html>
`;

function servePage(body = PAGE) {
  return jest.spyOn(http, 'request').mockResolvedValue({
    statusCode: 200, body, headers: { 'content-type': 'text/html' }, url: 'https://example.test'
  });
}

describe('Client', () => {
  afterEach(() => jest.restoreAllMocks());

  it('is a class a source instantiates, not a global object', async () => {
    // The exact shape every published source depends on.
    expect(await run('return [typeof Client, typeof new Client().get];'))
      .toEqual(['function', 'function']);
  });

  it('does not expose a global named client', async () => {
    // Providing one instead of the class is the mistake this suite exists
    // to prevent recurring.
    expect(await run('return typeof client;')).toBe('undefined');
  });

  it('gets a page and exposes body and statusCode', async () => {
    servePage('hello');
    expect(await run(`
      const res = await new Client().get("https://example.test");
      return { body: res.body, statusCode: res.statusCode };
    `)).toEqual({ body: 'hello', statusCode: 200 });
  });

  it('sends the headers a source passes', async () => {
    const spy = servePage();
    await run('await new Client().get("https://example.test", { Referer: "https://ref.test" });');
    expect(spy.mock.calls[0][0].headers).toMatchObject({ Referer: 'https://ref.test' });
  });

  it('form-encodes an object body on post, as the sites expect', async () => {
    const spy = servePage();
    await run('await new Client().post("https://example.test", {}, { name: "a b", id: 2 });');
    expect(spy.mock.calls[0][0].body).toBe('name=a%20b&id=2');
  });
});

describe('SharedPreferences', () => {
  it('is a class, and reads this source settings', async () => {
    expect(await run('return new SharedPreferences().get("quality");', {
      preferences: { quality: '1080p' }
    })).toBe('1080p');
  });

  it('refuses to let a source rewrite the user settings', async () => {
    await expect(run('new SharedPreferences().setString("a", "b");'))
      .rejects.toThrow(/cannot change preferences/);
  });
});

describe('DOM accessors', () => {
  afterEach(() => jest.restoreAllMocks());

  async function inPage(body) {
    servePage();
    return run(`
      const res = await new Client().get("https://example.test");
      const doc = new Document(res.body);
      ${body}
    `);
  }

  it('exposes text as a property, not a method', async () => {
    // `.text()` would return a function here and fail much later.
    expect(await inPage('return doc.selectFirst("span.block").text;')).toBe('Title One');
    expect(await inPage('return typeof doc.selectFirst("span.block").text;')).toBe('string');
  });

  it('exposes getHref and getSrc as properties', async () => {
    expect(await inPage('return doc.selectFirst("a.card").getHref;')).toBe('/series/one');
    expect(await inPage('return doc.selectFirst("img").getSrc;')).toBe('/img/one.jpg');
    expect(await inPage('return doc.selectFirst("img").getDst;')).toBe('/lazy/one.jpg');
  });

  it('exposes id and className as properties', async () => {
    expect(await inPage('return doc.selectFirst("a.card").id;')).toBe('first');
    expect(await inPage('return doc.selectFirst("a.card").className;')).toBe('card');
  });

  it('exposes innerHtml and outerHtml as properties', async () => {
    expect(await inPage('return doc.selectFirst("span.block").innerHtml;')).toBe('Title One');
    expect(await inPage('return doc.selectFirst("span.block").outerHtml;'))
      .toBe('<span class="block">Title One</span>');
  });

  it('keeps select, selectFirst and attr as methods', async () => {
    expect(await inPage('return doc.select("a.card").length;')).toBe(2);
    expect(await inPage('return doc.selectFirst("a.card").attr("href");')).toBe('/series/one');
  });

  it('walks siblings, parents and children as properties', async () => {
    expect(await inPage('return doc.selectFirst("div.grid").nextElementSibling.text;')).toBe('after');
    expect(await inPage('return doc.selectFirst("p.note").previousElementSibling.className;')).toBe('grid');
    expect(await inPage('return doc.selectFirst("span.block").parent.className;')).toBe('card');
    expect(await inPage('return doc.selectFirst("a.card").children.length;')).toBe(2);
  });

  it('returns null rather than throwing for a selector that misses', async () => {
    expect(await inPage('return doc.selectFirst(".nothing");')).toBeNull();
  });

  it('iterates a selection the way sources do', async () => {
    expect(await inPage(`
      const out = [];
      for (const el of doc.select("a.card")) out.push(el.selectFirst("span.block").text);
      return out;
    `)).toEqual(['Title One', 'Title Two']);
  });
});

describe('String helpers', () => {
  it.each([
    ['"a=b=c".substringAfter("=")', 'b=c'],
    ['"a=b=c".substringAfterLast("=")', 'c'],
    ['"a=b=c".substringBefore("=")', 'a'],
    ['"a=b=c".substringBeforeLast("=")', 'a=b'],
    ['"<i>x</i>".substringBetween("<i>", "</i>")', 'x'],
    ['"none".substringAfter("=")', 'none'],
    ['"none".substringBefore("=")', 'none'],
    ['"none".substringBetween("<", ">")', '']
  ])('%s', async (expression, expected) => {
    expect(await run(`return ${expression};`)).toBe(expected);
  });
});

describe('crypto helpers', () => {
  it('round-trips CryptoJS passphrase encryption', async () => {
    const encrypted = await run('return encryptAESCryptoJS("the manifest url", "s3cret");');
    expect(encrypted).toMatch(/^U2FsdGVkX1/); // base64 of "Salted__"

    expect(await run(`return decryptAESCryptoJS(${JSON.stringify(encrypted)}, "s3cret");`))
      .toBe('the manifest url');
  });

  it('refuses a payload that is not CryptoJS format', async () => {
    await expect(run('return decryptAESCryptoJS("bm90aGluZw==", "k");'))
      .rejects.toThrow(/Salted__/);
  });

  it('decrypts with an explicit key and iv, as cryptoHandler does', async () => {
    const nodeCrypto = require('crypto');
    const key = 'xxxmanga.woo.key';        // 16 chars, as a real source uses
    const iv = '0123456789abcdef';
    const cipher = nodeCrypto.createCipheriv('aes-128-cbc', Buffer.from(key), Buffer.from(iv));
    const payload = Buffer.concat([
      cipher.update('secret payload', 'utf8'), cipher.final()
    ]).toString('base64');

    expect(await run(
      `return cryptoHandler(${JSON.stringify(payload)}, ${JSON.stringify(iv)}, ${JSON.stringify(key)}, false);`
    )).toBe('secret payload');
  });

  it('encrypts and decrypts symmetrically through cryptoHandler', async () => {
    const encrypted = await run(
      'return cryptoHandler("round trip", "0123456789abcdef", "xxxmanga.woo.key", true);'
    );
    expect(await run(
      `return cryptoHandler(${JSON.stringify(encrypted)}, "0123456789abcdef", "xxxmanga.woo.key", false);`
    )).toBe('round trip');
  });

  it('rejects a key that is not a valid AES length', async () => {
    await expect(run('return cryptoHandler("x", "0123456789abcdef", "short", false);'))
      .rejects.toThrow(/16, 24 or 32 character key/);
  });

  it('unpacks a packed script without evaluating it', async () => {
    const packed = "eval(function(p,a,c,k,e,d){while(c--)if(k[c])"
      + "p=p.replace(new RegExp('\\\\b'+c.toString(a)+'\\\\b','g'),k[c]);return p}"
      + "('0 1=\\'2\\';',3,3,'var|file|https://cdn.test/master.m3u8'.split('|'),0,{}))";

    expect(await run(`return unpackJs(${JSON.stringify(packed)});`))
      .toBe("var file='https://cdn.test/master.m3u8';");
  });

  it('says clearly when a script is not packed', async () => {
    await expect(run('return unpackJs("var a = 1;");')).rejects.toThrow(/Not a packed script/);
  });

  it('reports deobfuscateJsPassword as unimplemented rather than guessing', async () => {
    // A wrong string here would be parsed by the source and fail somewhere
    // far away; an explicit error names the gap.
    await expect(run('return deobfuscateJsPassword("x");')).rejects.toThrow(/not implemented/);
  });
});

describe('MProvider', () => {
  it('gives a source its index entry and its preferences', async () => {
    expect(await run('return [this.source.baseUrl, this.getPreference("q")];', {
      source: { baseUrl: 'https://example.test' },
      preferences: { q: '720p' }
    })).toEqual(['https://example.test', '720p']);
  });

  it('provides the default getHeaders sources rely on', async () => {
    expect(await run('return this.getHeaders("https://x.test");', {
      source: { baseUrl: 'https://example.test' }
    })).toEqual({ Referer: 'https://example.test' });
  });
});
