# Decisions: @repo/web

The one Next.js app: the site, the library tab at `/library` and the cloud's
routes over `@repo/service`. The cloud's decisions are
`packages/service/CLAUDE.md`'s, and the library tab's
`apps/web/src/library/CLAUDE.md`'s.

## The app

- **Next.js's App Router in dataembed's shape, on port 5174 in development and
  under `next start`.** The Mac app's window, its origin pin and the
  extension's manifest name 5174, so dataembed's 3000 would be a client
  release for no gain. `apps/web/package.json`.
- **`/api/health` answers 200 only once the database has, and per request.** A
  liveness that skips the database passes a deployment with none, and a
  prerendered one answers from the build. `apps/web/src/app/api/health/route.ts`.
- **A sign-in or sign-up lands in the library unless something asked it back,
  and the site links the library.** Only a document load opens the account just
  signed in to. `apps/web/src/lib/next-path.ts`.
- **`proxy.ts` sends a request with no session cookie for a signed-in page to
  sign in, before any of it renders, and reads no session to do it.** A read
  would cost every library document a database query, so a cookie whose
  session ended is the page's own read to find. `apps/web/src/proxy.ts`.
- **A document rendered per request carries `proxy.ts`'s nonce policy, and a
  marketing page `next.config.ts`'s static one, whose inline scripts run.** A
  page built once cannot carry a per-request nonce; the no-flash theme script
  is the root layout's own, allowed by its hash, so that layout reads no
  request. `apps/web/src/lib/document-policy.ts`.
- **The nonce documents are an exact list, in `proxy.ts`'s set and matcher
  alike, and nothing suspends above their layout's `await connection()`.** A
  404 under the list, or a prerendered shell, is written without the nonce, and
  its scripts are refused. `apps/web/src/proxy.ts`.
- **A config header never reaches `/v1/blobs/`.** A config header replaces a
  route's header of the same name, so the site's policy would replace a file's
  sandbox. `apps/web/next.config.ts`.
- **A page asked for as markdown answers its one markdown source, negotiated in
  `proxy.ts`.** A server component renders HTML whatever was asked, and a page
  and its markdown drawn from two sources drift.
  `apps/web/src/lib/site-content.ts`.
- **A page names the answering deployment (`APP_URL`) where an agent connects,
  and the canonical site everywhere else.** A preview that named the site
  would send an agent, and what the preview handed it, there.
  `packages/service/src/app-url.ts`.
- **The licences page is written at prebuild from pnpm's list of every
  production package the site's workspace reaches.** Turbopack has no
  counterpart of Vite's `build.license`, so the list over-includes what only
  the server loads. `apps/web/scripts/write-licenses.ts`.
- **The home page's orb is plain three.js an effect mounts, and no React
  renderer draws it.** A renderer for one mesh is a second reconciler, whose
  peer ranges reach the catalog's React and name react-native and expo.
  `apps/web/src/components/geometric-orb.tsx`.
