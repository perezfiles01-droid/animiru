# Adding an extension

One file. Put a `.js` source in [`extensions/sources/`](extensions/sources)
and push — CI rebuilds `extensions/index.json` and the folder's README, and
the repository URL people have already pasted starts listing it.

```
https://raw.githubusercontent.com/perezfiles01-droid/animiru/main/extensions/index.json
```

That URL never changes. Adding an extension does not require anyone to paste
anything again.

## The header

Every source begins with a `mangayomiSources` declaration. This is the only
place an extension describes itself: the index is generated from it, so the
two cannot disagree.

```js
const mangayomiSources = [{
  name: "My Source",
  id: 1002,
  lang: "en",
  baseUrl: "https://example.com",
  iconUrl: "https://example.com/favicon.ico",
  version: "1.0.0",
  itemType: 1
}];
```

| Field | Required | What it does |
| --- | --- | --- |
| `name` | yes | Shown in the extension list. |
| `id` | yes | A whole number, unique in this folder. Two sources sharing one install over each other. |
| `baseUrl` | yes | The site. Reachable as `this.source.baseUrl`, and most sources build every request from it. |
| `version` | yes | See below — this one matters more than it looks. |
| `lang` | no | Defaults to `en`. |
| `iconUrl` | no | Shown beside the name. A missing icon is not an error, just blank. |
| `itemType` | no | `0` manga, `1` anime, `2` novel. Defaults to `1`. |
| `apiUrl` | no | When the API lives on a different host from the site. |
| `isNsfw`, `hasCloudflare` | no | Both default to `false`. |

## Bump the version when you change a source

This is the one that catches people out.

Animiru caches source code **by version**. Edit a source without changing its
`version` and the app keeps serving the code it already has — your fix simply
does not appear, with nothing anywhere to say why. Bump the version and it
takes effect on the next refresh.

## The class

```js
class DefaultExtension extends MProvider {
  async getPopular(page)                  { /* browse */ }
  async getLatestUpdates(page)            { /* optional */ }
  async search(query, page, filters)      { /* search */ }
  async getDetail(url)                    { /* one title + its episodes */ }
  async getVideoList(url)                 { /* playable streams */ }
  getSourcePreferences()                  { /* optional settings */ }
}
```

Write `constructor() { super(); this.client = new Client(); }` if you need a
constructor. `this.source` is attached to the instance afterwards, so
`this.source.baseUrl` is available in every method regardless.

## What a source may use

The sandbox is neither a browser nor Node. There is **no** `fetch`, `require`,
`window`, `document`, `URLSearchParams` or `setTimeout`, and `eval` and
`new Function` are disabled deliberately — that is part of what keeps a source
contained. Use `unpackJs()` for a packed script rather than reaching for
`eval`.

What is there: `new Client()` for HTTP, `new SharedPreferences()` for
settings, `new Document(html)` for parsing, the `substringAfter`/`Before`
string helpers, and the crypto helpers (`cryptoHandler`,
`decryptAESCryptoJS`, `unpackJs`, `deobfuscateJsPassword`). This is
Mangayomi's API, so a source written for Mangayomi runs here unmodified.

`extensions/README.md` has the full list, and the sources already in
[`extensions/sources/`](extensions/sources/) are worked examples.

## Mistakes that have actually happened

[PITFALLS.md](PITFALLS.md#extensions) lists them with their causes. The four
that have each cost a round trip:

- **The second argument to `Client.get` is the headers.** `{ headers: {...} }`
  sends one header called `headers` and none of the ones you meant.
- **The `id` must be unique.** Two sources sharing one overwrite each other.
- **The file must end in `.js`.** It used to be skipped in silence.
- **`getDetail` must set `name`.** Without it a title that reads correctly
  while browsing opens as "Untitled".

## Check it before you push

```
node scripts/generate-extension-index.js     # rebuilds the index
node scripts/generate-extension-readme.js    # rebuilds the folder's README
```

Both refuse a source missing a `name`, `id`, `baseUrl` or `version`, or
reusing another source's `id`, and list every problem at once. CI runs the
same checks, so a file that passes here will not fail there.

## When it does not work in the app

Animiru reports a failing extension with the line that failed, what it
probably means, and every HTTP request the source made before it gave up.
Start there — the request trace usually names the real cause.
