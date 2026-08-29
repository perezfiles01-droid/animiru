# Animiru

Animiru is an anime player for sources you install yourself. It ships with no
content of its own: you add an extension repository, install a source, and the
app browses, searches and plays from it.

Extensions use the format Mangayomi established — a JavaScript file declaring
`mangayomiSources` and a `DefaultExtension` class, listed in an `index.json`
served over HTTP — so a repository published for that app works here without
being rewritten.

## How it works

Sources are untrusted JavaScript that scrapes sites, so they run on the
Animiru server rather than in your browser. That is what lets a source fetch a
site sending no CORS headers, and it means the web app, the PWA and the
Android build all behave identically.

Each source runs in an isolated `node:vm` realm with no `require`, no
`process`, and no access to anything but a small bridge: HTTP with capped
redirects and size, a Jsoup-shaped DOM over cheerio, base64, hashes, HMAC,
AES-CBC, its own preferences, and a captured console. Every request is
re-checked against a private-address rule, so a source cannot ask the server
to fetch something inside its own network.

**This is isolation, not a security boundary.** The vm shares the server's
heap, and its timeout only interrupts synchronous code — a source that spins
after its first `await` will hold the event loop. That is acceptable for
sources you wrote or read. It is not acceptable for arbitrary third-party
repositories, and moving the runner to a separate host is the work to do
before those are promoted.

## Tech Stack

**Frontend:** React 18, React Router v6, hls.js, plain CSS
**Backend:** Node.js, Express, cheerio — no database, no accounts
**Mobile:** an Android WebView shell around the built web app
**CI:** GitHub Actions, APK published to GitHub Releases

## Getting started

```
cd backend  && npm install && npm run dev     # http://localhost:3001
cd frontend && npm install && npm start       # http://localhost:3000
```

Then open Settings, paste an extension repository's `index.json` URL, and
install a source.

To build an installable app, see [DEPLOYMENT.md](DEPLOYMENT.md) — the backend
must be deployed and its URL set as a repository variable, because the app
cannot run a source without one.

## Project structure

```
backend/
  extensions/          the source runtime
    sandbox.js         runs one method of one source; read the note at the top
    runtime.js         the API sources are written against, built inside the vm
    ops.js             everything a source can ask the host to do, in one file
    html.js            cheerio behind opaque handles
    http.js            the only way a source reaches the network
    repository.js      fetching and validating an index.json
  routes/
    extensions.js      repositories, source code, and running a method
    health.js
  api/index.js         serverless entry point
frontend/src/
  pages/               Home (the catalogue), Details, Watch, Settings
  components/          AnimeCard, SourceTabs, VideoPlayer, ExtensionManager
  services/
    extensions/        the API client and per-device install state
    providers/         the provider contract, and the shim onto it
mobile/android/        the WebView shell
```

## API

| Route                          | Does                                        |
| ------------------------------ | ------------------------------------------- |
| `POST /api/extensions/repository` | Lists the sources an `index.json` offers |
| `POST /api/extensions/source`  | Fetches a source's code and its declaration |
| `POST /api/extensions/run`     | Runs one method of one source               |
| `GET  /api/extensions/methods` | The methods a source may expose             |
| `GET  /api/health`             | Health check                                |

The server keeps no per-user state. Which repositories you added and which
sources you installed live in your browser, on the device.

## Known limitations

- A source may report that a video host requires a `Referer`. Browsers do not
  allow setting one, so such a host refuses to play even when the source found
  the URL correctly. Proxying playback through the backend would fix it.
- `eval` and `Function` are disabled inside the sandbox, which closes an
  escape route. A minority of published sources use `Function()` to
  deobfuscate video-host payloads and will not run.
- CI builds the app but does not run its tests.

## Licence

For personal use. Extensions determine what content the app can reach, and
what you install is your responsibility.
