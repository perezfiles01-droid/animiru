# Animiru extensions

An extension repository is a URL to an `index.json` listing sources. This is
one, served straight from GitHub.

## Install it

Settings → Extensions → paste:

```
https://raw.githubusercontent.com/perezfiles01-droid/animiru/main/extensions/index.json
```

Then install **Internet Archive** from the list it shows.

## What is here

**Internet Archive** — the Archive's public API. Free to watch, no key, no
scraping: it is a worked example of a source rather than a way to reach any
particular show. Search finds items by title; browsing shows what the Archive
files under animation. Content is what the Archive happens to hold, which
means public-domain and freely-licensed film rather than current series.

## Writing your own

A source is one JavaScript file. It declares what it is, and implements a
class the app calls:

```js
const mangayomiSources = [{
  name: "My Source",
  id: 1002,
  lang: "en",
  baseUrl: "https://example.com",
  version: "1.0.0",
  itemType: 1,
  isMetadataCapable: true
}];

class DefaultExtension extends MProvider {
  async getPopular(page)          { /* { list: [{name, imageUrl, link}], hasNextPage } */ }
  async getLatestUpdates(page)    { /* same shape */ }
  async search(query, page, f)    { /* same shape */ }
  async getDetail(url)            { /* { name, imageUrl, description, genre, episodes } */ }
  async getVideoList(url)         { /* [{ url, quality, headers }] */ }
  getSourcePreferences()          { return []; }
}
```

Add the file under `sources/`, add its entry to `index.json` with a matching
`pkgPath`, and the app picks it up on the next refresh.

### What a source can use

Sources run on the Animiru server in an isolated realm, against the same API
Mangayomi provides - so a source written for that app runs here unmodified.

| API | Does |
| --- | --- |
| `new Client().get(url, headers)` | HTTP GET, resolves to `{body, statusCode, headers, url}` |
| `new Client().post(url, headers, body)` | HTTP POST; an object body is form-encoded |
| `new Document(html)` | Parse HTML |
| `.select(sel)` / `.selectFirst(sel)` / `.attr(name)` | **Methods** |
| `.text` `.innerHtml` `.html` `.outerHtml` | **Properties**, not methods |
| `.getHref` `.getSrc` `.getDst` `.id` `.className` | **Properties** |
| `.children` `.parent` `.nextElementSibling` `.previousElementSibling` | **Properties** |
| `new SharedPreferences().get(key)` | This source's settings |
| `"a=b".substringAfter("=")` and Before/AfterLast/BeforeLast/Between | String helpers |
| `cryptoHandler(text, iv, key, encrypt)` | AES-CBC with a UTF-8 key and IV, over base64 |
| `encryptAESCryptoJS` / `decryptAESCryptoJS` | CryptoJS passphrase format |
| `unpackJs(code)` | Unpacks a p.a.c.k.e.r-obfuscated script |
| `base64Encode` / `base64Decode`, `crypto.md5/sha1/sha256/hmac` | Encoding and hashes |
| `console.log` | Captured and returned with the result |

The method-versus-property split is the one that bites: only `select`,
`selectFirst` and `attr` take parentheses. `el.text()` returns a function,
and the failure surfaces later, in parsing rather than at the access.

`encodeURIComponent` and `JSON` are available. `URLSearchParams`, `fetch`,
`require`, `process`, `setTimeout`, `eval` and `Function` are **not** - the
last two deliberately, since disabling code generation is part of what keeps
a source contained. `unpackJs` exists precisely so an obfuscated payload can
be read without them. `deobfuscateJsPassword` is not implemented and throws
saying so, rather than returning a wrong string a source would then parse.

### Things that will catch you out

- **`getVideoList` must return playable URLs.** The app plays `.m3u8` as HLS
  and everything else as a direct file.
- **A `Referer` a host requires cannot be honoured.** You may return
  `headers`, but browsers refuse to set that header, so a host enforcing it
  will not play. This is a known limitation, not a bug in your source.
- **Quality labels are free text.** A height is only read from a label that
  actually contains one, so "HD" sorts as unknown rather than being guessed
  at.
- **Ids are yours.** Whatever `link` you return comes back to `getDetail`
  unchanged, and whatever `url` you put on an episode comes back to
  `getVideoList`. Pack whatever you need into them.
