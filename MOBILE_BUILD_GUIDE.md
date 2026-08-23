# Animiru Android Build Guide

How to build the Animiru APK.

## What the APK actually is

A **WebView shell**. The APK contains one Android activity that hosts the
compiled React app from `frontend/build`. It is not a native Android client —
there is no native player, no native navigation, and no Android-side Firebase
integration. The UI, routing, video playback and API calls are all the same web
code that runs in a browser.

This matters when reading the rest of this guide:

| Claim you might expect | Reality |
| --- | --- |
| Native ExoPlayer video | No. Playback is the web app's HTML5 `<video>` / HLS.js |
| Native Firebase auth | No. Auth is the web app's JWT flow against the backend |
| Native navigation | No. React Router runs inside the WebView |
| Offline support | Only whatever the web app's service worker provides |

The APK is signed with the **Android debug key**. Android will warn on install,
and it cannot be published to the Play Store as-is.

## Prerequisites

- JDK 17
- Android SDK, platform 34
- The Gradle wrapper is committed, so you do **not** need Gradle installed

## Build

The web app must be built and copied into the assets source set **before**
Gradle runs. Skipping this step produces an APK that installs and launches to a
blank screen.

```bash
# 1. Build the web app
cd frontend
npm install          # plain install - see the note below
npm run build

# 2. Stage it into the APK's assets
cd ..
rm -rf mobile/android/app/src/main/assets
mkdir -p mobile/android/app/src/main/assets
cp -r frontend/build/. mobile/android/app/src/main/assets/

# 3. Build the APK
cd mobile/android
./gradlew assembleDebug
# -> app/build/outputs/apk/debug/app-debug.apk
```

> **Do not** add `--legacy-peer-deps` or `--force` to `npm install`. Those flags
> let npm ignore peer constraints and hoist `ajv@6` next to `ajv-keywords@5`,
> which breaks the build with
> `Cannot find module 'ajv/dist/compile/codegen'`.

### Release variant

```bash
./gradlew assembleRelease
# -> app/build/outputs/apk/release/app-release.apk
```

`release` is configured to use the debug signing key so it builds without a
checked-in keystore. For real distribution, generate a keystore and replace the
`signingConfig` in `app/build.gradle`:

```bash
keytool -genkey -v -keystore animiru.keystore \
  -keyalg RSA -keysize 2048 -validity 10000 -alias animiru
```

Never commit the keystore — `*.keystore` and `*.jks` are gitignored.

## Install on a device

```bash
adb install app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.animiru.app/.MainActivity
adb logcat | grep -i animiru
```

Or sideload: copy the APK to the device, allow installs from unknown sources
for your file manager, then open it.

## Project layout

```
mobile/android/
├── gradlew, gradlew.bat
├── gradle/wrapper/          # wrapper jar + properties (Gradle 8.7)
├── settings.gradle          # repositories live here ONLY
├── build.gradle             # AGP 8.5.2
└── app/
    ├── build.gradle
    ├── proguard-rules.pro
    └── src/main/
        ├── AndroidManifest.xml
        ├── assets/          # web build staged here (gitignored)
        ├── java/com/animiru/app/MainActivity.java
        └── res/             # layout, values, launcher icons
```

## Specifications

| Property | Value |
| --- | --- |
| Package | `com.animiru.app` |
| Min SDK | 21 (Android 5.0) |
| Target / Compile SDK | 34 (Android 14) |
| Version | 1.0.0 (code 1) |
| Gradle / AGP | 8.7 / 8.5.2 |
| Java | 17 |

## Implementation notes

**Assets are served over https://, not file://.** `MainActivity` uses
`WebViewAssetLoader` to serve `assets/` from `https://appassets.androidplatform.net/`.
Two reasons: the web app keeps its auth token in `localStorage`, which `file://`
origins restrict on several Android versions; and API requests get a real origin
instead of the opaque `null` a `file://` page would send.

**The asset handler is mounted at `/`, not `/assets/`.** Create React App emits
absolute paths like `/static/js/main.*.js`. Mounting deeper would 404 them.
Switching CRA to relative paths (`homepage: "."`) would instead break on
client-side routes, because relative paths would resolve against `/browse/`.

**SPA routes fall back to `index.html`.** React Router uses the history API, so
`/browse` has no matching asset. The handler falls back to `index.html` for
extension-less paths. Paths *with* an extension still return 404, so a genuinely
missing script stays visible rather than silently serving HTML.

## Troubleshooting

**`chmod: cannot access 'gradlew'`**
The wrapper is missing from your checkout. It is committed at
`mobile/android/gradlew`; re-checkout or regenerate with `gradle wrapper
--gradle-version 8.7`.

**App installs but shows a blank screen**
The assets were not staged. Run step 2 above and confirm
`mobile/android/app/src/main/assets/index.html` exists before building.

**`Build was configured to prefer settings repositories`**
Something re-added an `allprojects { repositories { ... } }` block to the
top-level `build.gradle`. Repositories belong only in `settings.gradle`, which
sets `FAIL_ON_PROJECT_REPOS`.

**`File google-services.json is missing`**
A Firebase dependency or the Crashlytics plugin was re-added. The WebView shell
does not use Firebase natively; remove it, or add a real `google-services.json`.

**Anime data does not load in the app**
Expected if the backend is not deployed. The WebView hosts the UI, but browsing
and playback call the backend API, which must be reachable over HTTPS from the
device. Set the API base URL at build time via `REACT_APP_API_URL`.

## CI

`.github/workflows/build-deploy.yml` builds the web app, stages it into
`assets/`, then runs `./gradlew assembleDebug` and uploads the APK as an
artifact. Running the workflow manually (`workflow_dispatch`) on `main` also
publishes a GitHub Release with the APK attached.

---

**Status:** the debug APK compiles in CI (`assembleDebug`, verified on commit
`1a324fe`). The release variant is best-effort and does not block the build.

**Not verified:** the APK has never been installed or launched on a device or
emulator. Whether the WebView actually renders the app, whether `localStorage`
auth survives, and whether video playback works are all still open. Treat the
runtime behaviour as untested until someone installs it — see `TESTING_GUIDE.md`.
