# Deploying the backend

Extensions execute on the server, not in the browser. That is what lets a
source scrape a site that sends no CORS headers, and it is why the installed
app needs a reachable backend before any source can run.

Until the two steps below are done, the app builds and installs but shows
nothing: it falls back to `http://localhost:3001/api`, which on a phone is
the phone itself.

## 1. Deploy the backend

The `backend/` directory is ready for Vercel: `vercel.json` routes everything
to `api/index.js`, which exports the Express app. `server.js` only binds a
port when run directly, so the same file serves both local development and a
serverless host.

From a terminal:

```
cd backend
npx vercel --prod
```

Or from a browser, which needs no terminal at all:

1. Go to https://vercel.com/new and import this repository.
2. Set **Application Preset** to **Express** - not **Services**. The
   repository holds a frontend and a backend, so Vercel's multi-service
   detection offers to deploy both; only the backend belongs here.
3. Set **Root Directory** to `backend`. Without it Vercel builds from the
   repository root, finds no entry point, and fails with
   `Cannot read properties of undefined (reading 'fsPath')`.
4. Deploy.

Vercel deploys the **production branch**, which defaults to `main`. Importing
before these files are on `main` fails for the same reason - there is nothing
to deploy yet.

Any Node host works the same way - Railway, Render, Fly - since they all
either run `npm start` or import the exported app.

Set these environment variables on the host:

| Variable       | Needed for                                          |
| -------------- | --------------------------------------------------- |
| `FRONTEND_URL` | The web app's origin, so CORS admits it. The Android app is allowed automatically. |

There is nothing else to configure: the server holds no accounts and no
per-user data. It fetches repositories, runs sources, caches, and forgets.

Confirm it is up:

```
curl https://your-backend.vercel.app/api/health
```

## 2. Point the app at it

The API base URL is compiled into the bundle by Create React App, so it is
fixed at build time and cannot be changed on the device.

This is already done. `build-deploy.yml` carries the deployed backend as its
default, so every build points at it with nothing to configure.

To point builds at a different backend, set a repository variable - **Settings
→ Secrets and variables → Actions → Variables → New repository variable** -
named `REACT_APP_API_URL`, with the value `https://your-backend/api`. It
overrides the default when present.

Note the trailing `/api` either way: the routes are mounted under it.

The build fails if the URL does not end up in the compiled bundle. That check
exists because the alternative is an APK that installs, opens, and silently
runs nothing - a failure that otherwise only shows up on a device.

## Local development

```
cd backend  && npm install && npm run dev     # http://localhost:3001
cd frontend && npm install && npm start       # http://localhost:3000
```

The frontend defaults to `http://localhost:3001/api`, so no configuration is
needed for local work.
