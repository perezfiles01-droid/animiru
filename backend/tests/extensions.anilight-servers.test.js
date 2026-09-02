/**
 * Which AniLight server leads, and which are asked for at all.
 *
 * Both were decided for a different host. The ordering put AnimeGG first
 * because it is the only backend Windows can play untouched by libmpv - true
 * there, irrelevant in a browser - and the provider list still named a
 * server the site has since dropped from its own menu.
 *
 * The file is read as text rather than run: these are two constants and a
 * comparator, and standing the whole source up against a fake AniLight to
 * assert an ordering would test the fake.
 */

const fs = require('fs');
const path = require('path');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', '..', 'extensions', 'sources', 'anilight.js'), 'utf8'
);

/** The rank() comparator, lifted out and made callable. */
function rankFn() {
  const body = SOURCE.match(/var rank = function \(v\) \{([\s\S]*?)\n {4}\};/);
  if (!body) throw new Error('rank() is no longer shaped as expected');

  // eslint-disable-next-line no-new-func
  return new Function('v', body[1]);
}

const entry = (quality) => ({ quality });

describe('the order servers are offered in', () => {
  const rank = rankFn();

  const order = (qualities) => [...qualities]
    .sort((a, b) => rank(entry(a)) - rank(entry(b)));

  // The site's own default, and the one confirmed to play here.
  it('puts MegaPlay ahead of everything', () => {
    expect(order([
      'AnimeGG 1080p [Sub]',
      'MegaPlay 1080p [Sub]',
      'MegaPlay 720p [Sub] ⟨fixed⟩'
    ])[0]).toBe('MegaPlay 1080p [Sub]');
  });

  /**
   * AnimeGG led because it is the only backend libmpv plays untouched on
   * Windows. Animiru plays through hls.js or the WebView's own HLS, where a
   * playlist is exactly what is wanted - and AnimeGG's coverage is partial,
   * so leading with it meant episodes it does not carry led with nothing.
   */
  it('no longer leads with AnimeGG', () => {
    expect(order(['MegaPlay 1080p [Sub]', 'AnimeGG 1080p [Sub]'])[0])
      .not.toContain('AnimeGG');
  });

  it('keeps AnimeGG in the list, ahead of the proxy-only entries', () => {
    const sorted = order([
      'Misora 1080p [Sub] ⟨fixed⟩',
      'AnimeGG 1080p [Sub]'
    ]);

    expect(sorted[0]).toContain('AnimeGG');
  });

  /**
   * The proxied entry only exists when someone configured a proxy, and
   * routing every byte through one when the stream plays on its own is a
   * cost. Behind the direct entry, not ahead of it.
   */
  it('prefers the direct MegaPlay stream to the proxied one', () => {
    expect(order([
      'MegaPlay 1080p [Sub] ⟨unwrapped⟩',
      'MegaPlay 1080p [Sub]'
    ])[0]).toBe('MegaPlay 1080p [Sub]');
  });

  it('still ranks the proxied MegaPlay above AnimeGG', () => {
    expect(order([
      'AnimeGG 1080p [Sub]',
      'MegaPlay 1080p [Sub] ⟨unwrapped⟩'
    ])[0]).toContain('MegaPlay');
  });
});

/**
 * Every provider asked for is a request, and every request a bot check
 * refuses is one the device has to make instead - and those are rationed.
 * Asking for a server the site no longer serves spends that budget on
 * nothing.
 */
describe('the providers asked for', () => {
  const providers = () => {
    const block = SOURCE.match(/var TS_PROVIDERS = \[([\s\S]*?)\];/);
    if (!block) throw new Error('TS_PROVIDERS is no longer shaped as expected');

    return [...block[1].matchAll(/id:\s*"([^"]+)"/g)].map((match) => match[1]);
  };

  /**
   * misora was removed once on the strength of a screenshot cropped to five
   * entries, on the reasoning that the site had dropped it. The full menu
   * lists it - selected, at that. An absence read off a partial list is not
   * an absence.
   */
  it('asks for misora, which the site still serves', () => {
    expect(providers()).toContain('misora');
  });

  it('still asks for misa, which it still serves', () => {
    expect(providers()).toContain('misa');
  });

  /**
   * Read off the site rather than guessed at: its watch URLs carry
   * ?server=<id> and its /sources call takes providerId=<id>, and the two
   * are the same namespace - "misa" appears in the menu and in this list
   * already, which is what makes the rest readable from a URL.
   */
  it('asks for every server the menu offers through /sources', () => {
    expect(providers().sort()).toEqual(
      ['kiwi', 'light', 'mello', 'misa', 'misora', 'near', 'rem']
    );
  });

  /**
   * Two of the menu's entries are reached another way, and listing them
   * here would fetch the same backend twice - spending requests that are
   * rationed the moment a bot check starts refusing them.
   */
  it('does not ask /sources for the embed server', () => {
    expect(providers()).not.toContain('meg');
  });

  // The source's own comment: AnimeGG is "the API's 'ryu' provider".
  it('does not ask /sources for AnimeGG under its API name', () => {
    expect(providers()).not.toContain('ryu');
    expect(SOURCE).toMatch(/resolveAnimeGG/);
  });

  /**
   * MegaPlay's CDN insists on its own Referer; every other provider wants
   * the stream's own origin, which is what a null means here. Getting this
   * backwards is a 403 from the CDN on a stream that resolved fine.
   */
  it('keeps MegaPlay the only one with a Referer of its own', () => {
    const block = SOURCE.match(/var TS_PROVIDERS = \[([\s\S]*?)\];/)[1];
    const withReferer = [...block.matchAll(/id:\s*"([^"]+)"[^\n]*referer:\s*"([^"]+)"/g)];

    expect(withReferer.map(([, id]) => id)).toEqual(['misa']);
  });
});
