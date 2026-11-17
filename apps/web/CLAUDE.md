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
- **A page asked for as markdown answers its one markdown source.** A page and
  its markdown drawn from two sources drift.
  `apps/web/src/lib/site-content.ts`.
- **A page names the answering deployment (`APP_URL`) where an agent connects,
  and the canonical site everywhere else.** A preview that named the site
  would send an agent, and what the preview handed it, there.
  `apps/web/src/lib/app-url.ts`.
- **The home page's orb is plain three.js an effect mounts, and no React
  renderer draws it.** A renderer for one mesh is a second reconciler, whose
  peer ranges reach the catalog's React and name react-native and expo.
  `apps/web/src/components/geometric-orb.tsx`.
