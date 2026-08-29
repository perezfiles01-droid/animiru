/**
 * The sandbox's job is to run untrusted source code usefully and to keep it
 * where it is. These tests cover both halves - the bridge API extensions
 * actually use, and the containment properties the design depends on.
 */

const { runExtension, extractMetadata, ExtensionError } = require('../extensions');
const http = require('../extensions/http');

/** Wraps a method body in the class shape the runner expects. */
function extensionWith(body) {
  return `
    class DefaultExtension extends MProvider {
      async search(query, page) {
        ${body}
      }
    }
  `;
}

async function search(body, options = {}) {
  return runExtension({ code: extensionWith(body), method: 'search', args: ['q', 1], ...options });
}

describe('extension sandbox', () => {
  describe('running extensions', () => {
    it('returns what the extension returns', async () => {
      const { result } = await search('return { list: [{ name: "Bleach" }], hasNextPage: false };');
      expect(result).toEqual({ list: [{ name: 'Bleach' }], hasNextPage: false });
    });

    it('passes arguments through', async () => {
      const { result } = await search('return { query, page };');
      expect(result).toEqual({ query: 'q', page: 1 });
    });

    it('gives the extension its index entry as this.source', async () => {
      const { result } = await search('return this.source.baseUrl;', {
        source: { baseUrl: 'https://example.test' }
      });
      expect(result).toBe('https://example.test');
    });

    it('exposes user preferences', async () => {
      const { result } = await search('return this.getPreference("quality");', {
        preferences: { quality: '1080p' }
      });
      expect(result).toBe('1080p');
    });

    it('captures console output instead of writing to the server log', async () => {
      const { logs } = await search('console.warn("odd markup", { n: 1 }); return null;');
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ level: 'warn', message: 'odd markup {"n":1}' });
    });

    it('reports a missing class rather than returning nothing', async () => {
      await expect(runExtension({ code: 'var x = 1;', method: 'search' }))
        .rejects.toThrow(/does not define a DefaultExtension class/);
    });

    it('reports an unimplemented method', async () => {
      await expect(runExtension({ code: extensionWith('return 1;'), method: 'getVideoList' }))
        .rejects.toThrow(/does not implement getVideoList/);
    });

    it('refuses a method that is not part of the contract', async () => {
      await expect(runExtension({ code: extensionWith('return 1;'), method: 'constructor' }))
        .rejects.toThrow(/Method not callable/);
    });

    it('surfaces an error thrown inside the extension', async () => {
      await expect(search('throw new Error("site changed layout");'))
        .rejects.toThrow(/site changed layout/);
    });

    it('rejects a source larger than the cap', async () => {
      await expect(runExtension({ code: 'x'.repeat(600 * 1024), method: 'search' }))
        .rejects.toThrow(/exceeds/);
    });
  });

  describe('HTML parsing', () => {
    const markup = `
      <div class="items">
        <a class="card" href="/anime/1" data-id="1"><span class="t">One</span></a>
        <a class="card" href="/anime/2" data-id="2"><span class="t">Two</span></a>
      </div>
    `;

    it('selects, reads text and reads attributes', async () => {
      const { result } = await search(`
        const doc = new Document(${JSON.stringify(markup)});
        return doc.select("a.card").map((el) => ({
          href: el.attr("href"),
          title: el.selectFirst("span.t").text()
        }));
      `);
      expect(result).toEqual([
        { href: '/anime/1', title: 'One' },
        { href: '/anime/2', title: 'Two' }
      ]);
    });

    it('returns null for a selector that matches nothing', async () => {
      const { result } = await search(`
        const doc = new Document(${JSON.stringify(markup)});
        return doc.selectFirst(".missing");
      `);
      expect(result).toBeNull();
    });

    it('exposes all attributes of a node', async () => {
      const { result } = await search(`
        const doc = new Document(${JSON.stringify(markup)});
        return doc.selectFirst("a.card").attrs();
      `);
      expect(result).toEqual({ class: 'card', href: '/anime/1', 'data-id': '1' });
    });

    it('walks parents and children', async () => {
      const { result } = await search(`
        const doc = new Document(${JSON.stringify(markup)});
        const card = doc.selectFirst("a.card");
        return { parent: card.parent().attr("class"), children: card.children().length };
      `);
      expect(result).toEqual({ parent: 'items', children: 1 });
    });
  });

  describe('crypto and encoding helpers', () => {
    it('round-trips base64', async () => {
      const { result } = await search('return base64Decode(base64Encode("ok"));');
      expect(result).toBe('ok');
    });

    it('hashes', async () => {
      const { result } = await search('return crypto.md5("abc");');
      expect(result).toBe('900150983cd24fb0d6963f7d28e17f72');
    });

    it('refuses an unsupported hash', async () => {
      await expect(search('return crypto.hmac("rot13", "k", "d");'))
        .rejects.toThrow(/Unsupported hash/);
    });

    it('decrypts AES-CBC, as video hosts require', async () => {
      const nodeCrypto = require('crypto');
      const key = nodeCrypto.randomBytes(16);
      const iv = nodeCrypto.randomBytes(16);
      const cipher = nodeCrypto.createCipheriv('aes-128-cbc', key, iv);
      const payload = Buffer.concat([
        cipher.update('https://cdn.test/master.m3u8', 'utf8'),
        cipher.final()
      ]).toString('base64');

      const { result } = await search(`
        return crypto.aesDecrypt(
          ${JSON.stringify(payload)},
          ${JSON.stringify(key.toString('hex'))},
          ${JSON.stringify(iv.toString('hex'))}
        );
      `);
      expect(result).toBe('https://cdn.test/master.m3u8');
    });
  });

  describe('containment', () => {
    it('has no require', async () => {
      const { result } = await search('return typeof require;');
      expect(result).toBe('undefined');
    });

    it('has no process, Buffer or globals from the host', async () => {
      const { result } = await search(`
        return ['process', 'Buffer', 'global', 'setTimeout', 'fetch']
          .map((name) => typeof globalThis[name]);
      `);
      expect(result).toEqual(['undefined', 'undefined', 'undefined', 'undefined', 'undefined']);
    });

    it('removes the raw host callables after bootstrap', async () => {
      const { result } = await search('return [typeof __hostSync, typeof __hostAsync];');
      expect(result).toEqual(['undefined', 'undefined']);
    });

    // The classic vm escape is to walk from any host-supplied object to its
    // Function constructor and compile code in the host realm. Two things
    // stop it here: the bridge is built inside the sandbox, so the
    // constructor found is the sandbox's own; and code generation is off in
    // this context, so that constructor cannot compile anything either.
    it('cannot compile code through a bridge function constructor', async () => {
      await expect(search('return client.get.constructor("return typeof process")();'))
        .rejects.toThrow(/Code generation from strings disallowed/);
    });

    it('cannot compile code through a Document', async () => {
      await expect(search(`
        const doc = new Document("<p>x</p>");
        return doc.constructor.constructor("return typeof process")();
      `)).rejects.toThrow(/Code generation from strings disallowed/);
    });

    it('reaches only the sandbox realm when walking prototypes', async () => {
      const { result } = await search(`
        return [
          client.get.constructor === Function,
          Object.getPrototypeOf(new Document("<p>x</p>")).constructor.constructor === Function
        ];
      `);
      expect(result).toEqual([true, true]);
    });

    it('interrupts a synchronous infinite loop', async () => {
      await expect(search('while (true) {} return 1;')).rejects.toThrow();
    }, 20000);

    it('cannot use eval to compile code', async () => {
      // codeGeneration.strings is off, so eval and Function are inert.
      await expect(search('return eval("1 + 1");')).rejects.toThrow();
    });
  });

  describe('extractMetadata', () => {
    it('reads the mangayomiSources declaration', () => {
      const sources = extractMetadata(`
        const mangayomiSources = [{
          name: "Example", id: 1, lang: "en",
          baseUrl: "https://example.test", itemType: 1
        }];
      `);
      expect(sources).toEqual([{
        name: 'Example',
        id: 1,
        lang: 'en',
        baseUrl: 'https://example.test',
        itemType: 1
      }]);
    });

    it('returns nothing for a file that declares no sources', () => {
      expect(extractMetadata('const x = 1;')).toEqual([]);
    });

    it('does not call into the extension', () => {
      expect(() => extractMetadata(`
        const mangayomiSources = [{ name: "A" }];
        class DefaultExtension extends MProvider {
          async search() { throw new Error("should not run"); }
        }
      `)).not.toThrow();
    });
  });
});

describe('extension HTTP', () => {
  it('recognises addresses that are not on the public internet', () => {
    const privateAddresses = [
      '127.0.0.1', '10.1.2.3', '192.168.0.5', '172.16.0.1', '169.254.169.254',
      '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', '::ffff:127.0.0.1'
    ];
    for (const address of privateAddresses) {
      expect({ address, private: http.isPrivateAddress(address) })
        .toEqual({ address, private: true });
    }
  });

  it('leaves public addresses alone', () => {
    for (const address of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700::1111']) {
      expect({ address, private: http.isPrivateAddress(address) })
        .toEqual({ address, private: false });
    }
  });

  it('refuses a request to a private address', async () => {
    await expect(http.request({ url: 'http://127.0.0.1:8080/admin' }))
      .rejects.toThrow(/private address/);
  });

  it('refuses a protocol other than http and https', async () => {
    await expect(http.request({ url: 'file:///etc/passwd' }))
      .rejects.toThrow(/Unsupported protocol/);
  });

  it('refuses a method outside the allowed set', async () => {
    await expect(http.request({ url: 'https://example.test', method: 'TRACE' }))
      .rejects.toThrow(/Unsupported method/);
  });

  it('strips headers an extension must not control', () => {
    expect(http.sanitizeHeaders({
      'User-Agent': 'Animiru',
      Host: 'evil.test',
      'Content-Length': '0'
    })).toEqual({ 'User-Agent': 'Animiru' });
  });

  it('reaches the network only through the sandbox bridge', async () => {
    // No host fetch exists inside the sandbox, so a source that tries to
    // reach the network any other way fails rather than succeeding quietly.
    const { result } = await runExtension({
      code: extensionWith('return typeof XMLHttpRequest + "," + typeof fetch;'),
      method: 'search',
      args: ['q', 1]
    });
    expect(result).toBe('undefined,undefined');
  });
});
