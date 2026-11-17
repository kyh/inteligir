# `@repo/web` — inteligir.com

The one Next.js app, on its App Router: the site, the library tab at
`/library`, and the cloud's routes over `@repo/service` and `@repo/db`. Its
decisions are this app's [`CLAUDE.md`](CLAUDE.md), and the library tab's
[`src/library/CLAUDE.md`](src/library/CLAUDE.md).

## Layout

```
src/
  app/           the App Router's layouts, pages and route handlers; (marketing)/ the site's pages
  proxy.ts       the session-cookie gate, the nonce policy and markdown negotiation
  library/       the library tab: its code, styles and decisions, its suites under jsdom
  components/    the site's own components
  lib/           the site's auth client, document policies, config and page markdown
scripts/         write-licenses.ts, which writes public/licenses.md at prebuild
next.config.ts   Cache Components, the React Compiler, the static policy and headers, `?raw`
vercel.json      the functions' region
```

## Routes

| Route                                      | What                                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| `/`, `/about`, `/contact`                  | the site's pages, prerendered; their markdown under `Accept: text/markdown` |
| `/privacy`, `/terms`                       | `docs/privacy.md` and `docs/terms.md`, rendered                             |
| `/library`, `/library/settings`            | a 307 to `/app/sign-in?next=…` with no session cookie                       |
| `/app`                                     | a 307 to `/library`                                                         |
| `/app/sign-in`, `/app/sign-up`             | the account pages, skipped to `next` when signed in                         |
| `/app/forgot-password`                     | asks for the reset mail                                                     |
| `/app/reset-password`                      | the reset mail's link: a new password on its token                          |
| `/llms.txt`, `/robots.txt`, `/sitemap.xml` | for agents and crawlers                                                     |
| `/licenses.md`                             | every production package's licence, written at prebuild                     |
| `/api/auth/*`                              | Better Auth, its allowlisted routes alone (`@repo/service`'s `auth/`)       |
| `/api/sign-up`                             | sign-up behind the invite gate, POST alone                                  |
| `/api/markdown/*`                          | what `proxy.ts` rewrites a markdown request to; no public address           |
| `/api/health`                              | `{"ok":true}` once the database answers, else 503                           |
| `/api/*`                                   | a JSON 404                                                                  |
| `/v1/rpc/*`                                | `/v1`'s one wire, POST alone (`@repo/service`'s `rpc/v1-rpc.ts`)            |

The library tab's code is here, but no page mounts it yet: its suites draw it
over memory.

## Testing and the dev loop

`pnpm dev:web` runs `next dev` on 5174, and `pnpm --filter @repo/web build`
then `start` serve the built app there; both read the root `.env.local`, then
`.env`. `next build` must list `/library*` and `/app/*` as `ƒ`, never `◐`: a
partial prerender writes its shell's scripts without the nonce. This app's
suites are three vitest projects (`vitest.config.ts`): `site`, under node, and
the tab's `library` (node, `*.test.ts`) and `library-dom` (jsdom,
`*.test.tsx`), compiled by the React Compiler as it ships. `typecheck` runs
`next typegen`, then the app's program.
