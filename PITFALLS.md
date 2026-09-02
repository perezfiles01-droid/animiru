# Pitfalls

Faults that reached a device, what actually caused them, and what now stops
them coming back.

Every entry here cost a round trip: a build, an install, a report. They are
written down because each one looked like something else — a broken
extension, a broken app, a broken site — and the wrong diagnosis is what made
them expensive rather than the fix.

Where a test pins a fault, it is named. **A note without a test is a note,
not a guarantee**, and those are marked as such.

---

## Android and the WebView

The app is a WebView shell serving the compiled React app from
`https://appassets.androidplatform.net` — a virtual origin that exists only
inside the app. That single fact caused several of these.

### An update would not install, and uninstalling lost everything

`build.gradle` signed every build with `signingConfigs.debug`, and CI holds no
keystore, so the Android plugin generated a fresh throwaway key on each
runner. Android refuses an update whose signature differs from the installed
app, so the only way forward was uninstalling — which deletes app storage, and
with it the library, sources, preferences and tracker connection.

**Now:** a stable key from `ANIMIRU_KEYSTORE_BASE64` / `ANIMIRU_KEYSTORE_PASSWORD`.
CI reads the certificate back out of the built APK and compares it to the
keystore; a mismatch fails the build. Without the secret it falls back to the
debug key and warns loudly rather than silently shipping an uninstallable APK.

**If the keystore is ever lost, no future build can update the app.** Keep it.

### A `data:` URL cannot be handed to the browser

Export produced a `data:` link and clicked it. `shouldOverrideUrlLoading`
treated only `.apk` as a download and sent everything else to the browser,
which cannot open a `data:` URL — so the button did nothing at all. Had it
reached the download listener, that listener passed everything to the
updater, which expects an APK.

**Now:** `data:` counts as a download and is written to Downloads through
MediaStore, since an app cannot write shared storage directly from Android 10.

### `<input type="file">` is inert without `onShowFileChooser`

A WebView drops the request. The Import button opened nothing, silently.

**Now:** implemented, with an `ActivityResultLauncher`. A cancelled picker
still answers the callback, or the input stays wedged and never opens again.

### `target="_blank"` and `window.open` are dropped

Unless `setSupportMultipleWindows` is set *and* `onCreateWindow` is
implemented. Both are.

### OAuth cannot redirect back to the app

The login page opens in the real browser, and `appassets.androidplatform.net`
does not resolve there. A redirect to the app's own address dead-ends on
`ERR_NAME_NOT_RESOLVED` with the token stranded in the browser.

**Now:** AniList's PIN page is the redirect. It displays the token to copy
back into the app, which works from any browser on any device.

> **The rule behind all of these:** WebView behaviour cannot be tested from
> the environment this app is developed in. Anything that depends on it needs
> a path that does not — which is why Backup has a copy-and-paste route
> alongside the file one. That route needs no download handler, no file
> chooser and no permission, so it cannot fail the way the others can.

---

## Extensions

### The second argument to `Client.get` **is** the headers

Passing `{ headers: {...} }` sends one header literally named `headers` and
none of the ones intended. Re:ANIME shipped this way.

**Pinned by** `backend/tests/extensions.source-contract.test.js`, over every
bundled source. Verified by reintroducing it.

### Ids must be unique whole numbers

Two sources sharing an id overwrite each other on install; the folder shows
one where it holds two. Re:ANIME arrived carrying AnimePahe's id.

**Pinned by** the same file, and by the index generator, which refuses to
build.

### A source must be a `.js` file

`Reanime` — no extension — was skipped in silence. It sat in the folder, never
reached the index, and nothing anywhere said why.

**Pinned by** `extensions.index-generator.test.js`. The generator now refuses
the build and names what to rename the file to.

### `getDetail` must set a name

AnimeParadise's set `imageUrl`, `description`, `genre`, `status`, `link` and
`chapters` — and no `name`. Browsing showed the title, because that comes from
search; opening it showed "Untitled".

**Not statically checked, deliberately.** A check was written for exactly this
bug and did not catch it: `getDetail` pushes chapters as `{ name: epName }`,
so an episode's name satisfied any pattern looking for a name in the method.
It passed on the bug it existed for, which is worse than no check.

**Instead:** the app carries the title from the card into the detail link and
uses it whenever `getDetail` returns none. Pinned by *"a source that returns
no title"* in the frontend Details tests.

### Bump the version when you edit a source

Source code is cached **by version**. An edit without a bump keeps serving the
old code, with nothing anywhere to say why.

### Sources are unreachable from the development environment

Every outbound host is denied by the network policy here. Endpoint shapes and
selectors are therefore written against documentation, never captured from a
live response, and **that gap is real**. Say so when it applies rather than
implying a source was verified end to end.

---

## Subtitles

### ASS is a subtitle format, not a broken file

Two separate gates refused it: the proxy rejected the `.ass` extension before
reading a byte, and the converter accepted only files containing `-->`, which
is SRT and VTT syntax. The result was *"it has no cue timings"* — blaming the
file for lacking something ASS has never used.

**Now:** converted. Every `Dialogue:` row carries a start, an end and text.
Styling is dropped, because positioning and karaoke have no equivalent in a
`<track>`. **Pinned by** tests in both `backend/tests/extensions.subtitles.test.js`
and `frontend/src/services/__tests__/subtitles.test.js`.

The `Text` field is last and may contain commas of its own, so a row is split
on the column count the `Format` line declares — splitting on every comma
truncates any line of dialogue containing one.

### Do not borrow subtitles from another source

It was considered and rejected. Encodes trim recaps and ad breaks
differently, so a file from one release drifts against another's video — and
it needs cross-source episode matching, which is already fuzzy. Subtly wrong
subtitles are worse than none.

### Judge the content, not the extension

Hosts routinely serve VTT from a `.srt` URL and the other way round. The
format is decided from what arrives.

---

## The player

### Two soundtracks at once

Teardown destroyed the hls.js instance but never touched the video element,
and on the native path the element keeps its own `src`. An element still
holding a loaded source goes on decoding it, so switching server or episode
left the previous audio running underneath the new one.

**Now:** pause, drop the source, `load()`. Removing the attribute alone does
not stop a media element that has already buffered. **Pinned by** *"not
playing two things at once"* in the VideoPlayer tests.

### `autoPlay` is not how to autoplay here

The attribute fires whenever the element has a source — including a stale one
mid-teardown, which was one of the ways two soundtracks started at once.
`play()` is called explicitly instead, once the stream is attached.

---

## Styling

### `--accent` is a background colour

It is `#0f3460`, a dark navy. Rules asking for `color: var(--accent, #8ea2d8)`
expected a light-blue fallback, but the token exists, so the fallback never
applied and the text rendered navy on navy. Two buttons and the recommendation
percentage were invisible.

**Pinned by** `frontend/src/styles/__tests__/palette.test.js`: every token
exists, `--accent` is never used as a text colour, and no rule depends on a
fallback for a token that does. Use `--accent-text` or `--highlight` for text.

> An outlined control in a dark theme leans entirely on its text colour for
> legibility. Fill the ones that matter.

---

## An empty result is a failure with no evidence

`getVideoList` returning `[]` is not an exception, so the sandbox built no
diagnostics for it and the player showed one bare sentence: "This source found
no video for that episode." No request trace, no source name, no line — every
report of it was unanswerable, and the same sentence covered a blocked fetch,
a redirect, and markup that had moved.

A successful run already carries the requests it made; only the result was
being kept (`return outcome.result`). The provider now keeps the whole run and
throws an error carrying diagnostics in the shape a real failure would have
had, so the existing report renders it — and the source switcher is offered
from the error itself, because another source is the actual way out.

**Pinned by** `frontend/src/services/providers/__tests__/extension.test.js`
("when a source returns no playable video") and
`frontend/src/pages/__tests__/Watch.test.jsx` ("when a source finds no
video"). The page assertion is scoped with `within` to the error block: the
same switcher sits further down the page, and an unscoped query passed with
the switcher removed.

> When something produces nothing, say what it did on the way there. A
> symptom without a trace generates another round of guessing, not a fix.

---

## A User-Agent alone is not a browser

KickAssAnime answered 403 in 148ms to a request that already carried a full
Chrome User-Agent. The rest of the request gave it away: no `Accept-Language`,
no `Sec-Fetch-*`, no `sec-ch-ua`. A Chrome UA with none of those is a shape no
browser produces, and the cheapest tier of every bot check tests exactly that
inconsistency. Below the headers, Node's TLS handshake offers ciphers and
signature algorithms in an order no browser sends, which the next tier
fingerprints.

`backend/extensions/http.js` now completes the request: client hints, Sec-Fetch
metadata chosen by what the request actually is (a JSON call is a script's
fetch, not a navigation), and an `https.Agent` with Chrome's cipher order. Only
headers the source did not set are filled — a source naming its own User-Agent
or Referer knows something this file does not — and matching is
case-insensitive, or a source that wrote `user-agent` would get two of them.

**Pinned by** `backend/tests/extensions.http-identity.test.js`, including that
the request actually carries it: building the headers correctly is worth
nothing if the wiring drops them.

> Still not a complete disguise. A browser negotiates HTTP/2 and this client
> speaks HTTP/1.1, and the request comes from a hosting provider's IP either
> way. Only fetching from the user's own device fixes that.

---

## The block is on the address, not the request

KickAssAnime refused the server 403 in 148ms with a full Chrome User-Agent
already on the request. No header and no TLS change fixes that: extensions run
on the Animiru server, so every request comes from a hosting provider's
address, and that is what bot protection blocks. The user's own connection is
not blocked, because it is not a datacenter.

So a 403, 429 or 503 stops the run, names the request, and the app makes that
one request from the device through a native bridge - a plain `fetch()` cannot,
because the app is served from a virtual origin inside the WebView and every
site is cross-origin. The run is then **replayed** with the answer supplied,
not resumed: suspending a sandbox between HTTP requests would mean holding a
live VM per user on a serverless host.

Three things this gets wrong if built carelessly, each pinned by a test:

- A source that catches a failed request and falls back would swallow the
  refusal and return half an answer. The refusal is recorded as well as
  thrown, and takes precedence over the result.
- A 404 is an answer about the URL and a 500 is the site being broken. Neither
  is about who is asking, so neither is worth a device round trip.
- The request key includes the body. Answering a search for "bleach" with the
  result for "naruto" is worse than failing.

**Pinned by** `backend/tests/extensions.handoff.test.js`,
`backend/tests/extensions.routes.test.js`,
`frontend/src/services/extensions/__tests__/deviceFetch.test.js` and
`client.handoff.test.js`.

> The device path must refuse private addresses exactly as the server does.
> Moving a request to the phone must not become the way an extension reaches
> the user's own network.

---

## Fullscreen that leaves the clock on the video

Entering fullscreen locked the orientation and kept the screen awake, and
never touched the system bars - so the time, the battery percentage and the
navigation buttons sat on top of every episode. There was no
`WindowInsetsController` call anywhere in the shell; the bars had simply never
been asked to go.

Hiding them is one line. The parts worth remembering are the rest:

- The bars are **hidden, not removed** - a swipe brings them back transiently,
  so Back and Home stay reachable.
- `setDecorFitsSystemWindows(false)`, or the gap they occupied stays behind.
- Restoring on exit is not optional. A shell that hides them and forgets is a
  worse bug than the one being fixed, which is why it is one method with a
  flag rather than two that can drift apart.
- The display cutout is used **only** while fullscreen; elsewhere the app
  wants the safe area.

**Pinned by** `backend/tests/mobile.shell.test.js`, which reads the Java as
text - there is no SDK or device here, so the enter and exit paths are checked
for symmetry rather than executed. That file is the right home for any shell
property whose absence is invisible until someone is holding a phone.

---

## Effects run in the order they are declared

The player keeps its position in a ref, because the element cannot be asked:
switching server tears the old source down with `load()`, which resets
`currentTime` to zero before the next attach reads it - so the code that meant
to carry the position across a switch had never worked.

Resetting that ref for a new episode was first written as an effect. It was
declared *after* the effect that attaches the stream, so on opening episode 2
the stream effect had already read episode 1's position and queued a seek to
it. Episode 2 opened seven minutes in. The reset now happens during render,
guarded by a ref holding the episode being played, which is the only ordering
that cannot drift.

**Pinned by** `frontend/src/components/__tests__/VideoPlayer.test.jsx`, "does
not carry the position into another episode" - which passed while the bug was
live, because it re-rendered with `{...streams}`. Spreading kept the same
option objects, so the player never reattached and the test proved nothing.
The fix was to give the second episode genuinely different options.

> Two lessons, and the second is the general one: a test that re-renders with
> a shallow copy may not be re-rendering anything at all. Break the fix; if
> the test still passes, the test is the thing that is broken.

---

## Silencing a rule that is not loaded is itself an error

Three releases in a row failed to build on one line:

    // eslint-disable-next-line react-hooks/exhaustive-deps

The production build's ESLint config does not register that rule, and
disabling an unknown rule is an error - which CI, treating warnings as errors,
refuses. Nothing in `react-scripts test` sees it: the test runner does not lint
the way the build does, so a full green test suite says nothing about whether
the app compiles.

Worse than the failure was not noticing it. A tag-watcher sat polling for a
release that was never coming while three commits failed behind it.

**Run `npm run build` in `frontend/` before pushing.** The tests are not a
substitute for it, and a build failure is invisible from a passing suite.

> The general form: when waiting on a build, check that the build is running.
> Absence of a result is not progress.

---

## A hook in a loop, in a project whose lint cannot see it

`FrontRows` first called `useChart` inside `CHARTS.map(...)`. It worked, and
the build passed - the list is a module constant, so the hook order never
varied. Both facts are traps: it breaks the moment that list is filtered or
built from state, and `react-hooks/rules-of-hooks` is not registered in this
project's build, so nothing would have said so.

The calls are written out one per row instead.

> The build passing is not evidence a rule was checked. Know which rules this
> project actually runs before relying on one to catch you.

---

## A budget spent one item at a time is not a budget

Handing a refused request to the device worked exactly as built, and users
still read "this request has to be made from the device". The run recorded
only the *first* refusal, so each replay carried one answer forward - while
sources fan out. AniLight asks several backends for one episode in parallel,
and a site refusing the server refuses all of them, so a run needing a dozen
answers needed a dozen rounds against an app that allows four.

Nothing was broken. The mechanism was correct and the arithmetic was not.

A round now collects every request the run wants, deduplicated, and the app
fetches them together. Two rounds finish what twelve could not. The named
request still leads and still fails the round if it cannot be fetched - it is
the one the run stopped on, and without it the next round stops in the same
place - while a sibling that fails is simply left for the next round.

**Pinned by** `backend/tests/extensions.handoff.test.js` and
`frontend/src/services/extensions/__tests__/client.handoff.test.js`. The
dedupe test first used three different URLs, which can never collide: it
passed whether or not anything deduplicated. It asks for the same URL twice
now.

> When a mechanism is right and the symptom persists, count what it does per
> round against what the work actually needs.

---

## An absence read off a partial list is not an absence

A screenshot of AniLight's server menu showed five entries, and `misora` was
not among them - so it was removed from the source, with a commit message
stating the site had dropped it. The menu has nine entries. The screenshot
was cropped, `misora` was in the part that was not visible, and it was the
server actually selected.

Nothing in the evidence said "this list is complete". The reasoning treated
it as though it had.

Two more entries were nearly mishandled the same way, in the opposite
direction - by adding everything the full menu showed:

- **RYU is AnimeGG.** The source's own comment says so ("the API's 'ryu'
  provider"), and it already has its own resolver. Listing it would have
  fetched the same backend twice.
- **MEG is the embed path**, resolved from `embed_url`. `/sources` is the
  wrong endpoint for it.

**Pinned by** `backend/tests/extensions.anilight-servers.test.js`, which now
asserts the exact set rather than a subset - `arrayContaining` would pass
with `ryu` wrongly added.

> Read what a screenshot shows, not what it implies about what it does not
> show. When a conclusion depends on something being absent, say that the
> evidence may be partial - or ask for the whole of it.

---

## Verification

The habit that caught most of the above, and is worth keeping:

**Break the fix and watch the test fail.** A test written alongside a change
usually passes for the wrong reason. Reintroducing the bug is the only cheap
proof that the test is load-bearing. It is how the `--accent` check was found
to be matching `background-color`, and how the `getDetail` name check was
found to be useless.

**Check what a build actually built.** A release was reported as containing a
fix it was built before. Read the run's `head_sha`.

**A CI check that blocks a correct build spends the same trust as a real
failure.** The signature verification failed a perfectly signed APK because
`keytool` writes the keystore's fingerprint as `SHA-256:` and the APK's as
`SHA256:`. Match on shape, not on labels.
