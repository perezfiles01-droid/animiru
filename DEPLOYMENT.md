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

```
cd backend
npx vercel --prod
```

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

In GitHub: **Settings → Secrets and variables → Actions → Variables → New
repository variable**

| Name                  | Value                                     |
| --------------------- | ----------------------------------------- |
| `REACT_APP_API_URL`   | `https://your-backend.vercel.app/api`     |

Note the trailing `/api` - the routes are mounted under it.

Every APK built after this points at that backend. Builds run before you set
it are not retrofitted; run the workflow again to produce a new one. The
build logs a warning when the variable is missing rather than failing, so a
build without it still produces an installable APK - it just will not be able
to run extensions.

## Local development

```
cd backend  && npm install && npm run dev     # http://localhost:3001
cd frontend && npm install && npm start       # http://localhost:3000
```

The frontend defaults to `http://localhost:3001/api`, so no configuration is
needed for local work.
