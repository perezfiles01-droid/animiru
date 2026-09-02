# snitchmd — vendored copy

**Upstream:** https://github.com/syabro/snitchmd
**Commit:** 0f3562c16de3190a97268075b6c5478c66e91052
**Vendored:** 2026-09-02
**License:** MIT, © Max Syabro — see `LICENSE`, which is kept with the code.

This is somebody else's project, copied in unmodified. It arrived here by way
of a fork, `perezfiles01-droid/snitchmd`, which was byte-identical to upstream
at the commit above — the fork carried no changes of its own.

## What it is for here

A **development tool**, run on a maintainer's own machine. It turns a URL into
clean Markdown through a headless browser, which is how markup gets captured
from a site that will not answer a plain fetch.

That is the blocker it exists here to solve. Writing a source for
`extensions/sources/` means reading the site's actual HTML. Several candidate
sites cannot be loaded from the environments this repository is worked on, and
a parser written without seeing the markup is invented rather than written —
it fails on every site it is pointed at. Capturing a real page with snitchmd
and writing the source against that is the difference.

Typical use:

```bash
snitchmd https://some-anime-site.example > /tmp/page.md
```

## What it is NOT for

**It is not part of the request path, and must not become part of it.** Two
reasons, either sufficient:

1. **It cannot run where the backend runs.** The backend is a Vercel
   serverless function (`backend/vercel.json`). snitchmd is a Docker image
   running headless Chromium, optionally under Xvfb. A serverless function
   cannot run Docker or spawn a browser.

2. **It addresses a cause this codebase does not have.** CloakBrowser defeats
   *fingerprinting*. Animiru is not blocked for its fingerprint; it is blocked
   for its address, because requests come from a hosting provider. See the
   note at the top of `backend/extensions/handoff.js`. A perfect browser
   fingerprint originating from a datacenter is still a datacenter, and is
   refused identically.

Animiru's answer to bot protection is the device handoff: the server names the
one request it was refused, and the user's phone — a residential address
running a real browser — makes it. That attacks the thing actually being
judged. snitchmd would not.

## Updating this copy

Re-copy from upstream at a newer commit and update the commit line above.
`backend/tests/vendor.provenance.test.js` checks that this file, the commit,
and the licence stay present — for this directory and for any other added
under `vendor/` later.
