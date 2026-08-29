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

Sources run on the Animiru server in an isolated realm. There is no browser
and no Node here - only the language itself plus this bridge:

| API | Does |
| --- | --- |
| `client.get(url, headers)` | HTTP GET, returns `{statusCode, body, headers, url}` |
| `client.post(url, headers, body)` | HTTP POST |
| `new Document(html)` | Parse HTML |
| `.select(sel)` / `.selectFirst(sel)` | Query it, Jsoup-style |
| `.text()` / `.attr(name)` / `.html()` | Read a node |
| `base64Encode` / `base64Decode` | Base64 |
| `crypto.md5/sha1/sha256/hmac` | Hashes |
| `crypto.aesDecrypt(payload, key, iv)` | AES-CBC, for hosts that obfuscate manifests |
| `preferences.get(key)` | This source's settings |
| `console.log` | Captured and returned with the result |

`encodeURIComponent` and `JSON` are available. `URLSearchParams`, `fetch`,
`require`, `process`, `setTimeout`, `eval` and `Function` are **not** - the
last two deliberately, since disabling code generation is part of what keeps
a source contained. A source that needs to deobfuscate a payload should use
`crypto` rather than evaluating a string.

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
