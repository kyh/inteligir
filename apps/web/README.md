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
  instrumentation-client.ts  what every page runs before it hydrates: zod with no eval
  library/       the library tab: its code, styles and decisions, its suites under jsdom
  components/    the site's own components
  lib/           the site's auth client, document policies, config and page markdown
agent/           the built-in agent, eve's: its channel, hooks, tools, filing rules and mock model
scripts/         write-licenses.ts, which writes public/licenses.md and the vendored texts at prebuild
next.config.ts   Cache Components, the React Compiler, the static policy and headers, Turbopack's
                 `?raw` and the import and export workers' alias, eve's mount
vercel.json      the functions' region and the crons
```

## Routes

| Route                                              | What                                                                        |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| `/`, `/about`, `/contact`                          | the site's pages, prerendered; their markdown under `Accept: text/markdown` |
| `/privacy`, `/terms`                               | `docs/privacy.md` and `docs/terms.md`, rendered                             |
| `/library`, `/library/settings`                    | the library tab, Settings over it; a 307 to `/app/sign-in?next=…` unsigned  |
| `/app`                                             | a 307 to `/library`                                                         |
| `/app/sign-in`, `/app/sign-up`                     | the account pages, skipped to `next` when signed in                         |
| `/connect/authorize`                               | an assistant's consent page, on the request the OAuth provider signed       |
| `/llms.txt`, `/robots.txt`, `/sitemap.xml`         | for agents and crawlers                                                     |
| `/licenses.md`, `/licenses/*.txt`                  | every production package's licence and each vendored text, at prebuild      |
| `/api/auth/*`                                      | Better Auth, its allowlisted routes alone (`@repo/service`'s `auth/`)       |
| `/api/sign-up/code`                                | mails a sign-up code once the invite and the address pass, POST alone       |
| `/api/sign-up`                                     | sign-up behind the invite gate, on that code, POST alone                    |
| `/api/markdown/*`                                  | what `proxy.ts` rewrites a markdown request to; no public address           |
| `/api/health`                                      | `{"ok":true}` once the database answers, else 503                           |
| `/api/dev/files`                                   | off Vercel with no Blob key, the folder store's upload, PUT alone; else 404 |
| `/api/cron/jobs`                                   | Vercel Cron, every minute: drains every account's due jobs                  |
| `/api/cron/housekeeping`                           | Vercel Cron, hourly: prunes change sets and op answers, releases files      |
| `/api/cron/agent`                                  | Vercel Cron, every 15 minutes: the agent's stranded turns and threads       |
| `/api/*`                                           | a JSON 404                                                                  |
| `/v1/rpc/*`                                        | `/v1`'s one wire, POST alone (`@repo/service`'s `rpc/v1-rpc.ts`)            |
| `/v1/rpc/library/agent/events`                     | a thread's events as one stream, cut at 280 s for the device to pick up     |
| `/v1/blobs/<sha>`                                  | a library file's bytes, HEAD and ranges, under the file's own policy        |
| `/eve/v1/*`                                        | the built-in agent, eve's, which only the app calls; `/eve/v1/health` open  |
| `/mcp`                                             | the library's tools for a connected assistant, POST alone (`mcp/`)          |
| `/.well-known/oauth-protected-resource/*`          | the connector's metadata, naming its authorization server                   |
| `/.well-known/oauth-authorization-server/api/auth` | the OAuth provider's metadata, its issuer `/api/auth`                       |

## Testing and the dev loop

`pnpm dev:web` runs `next dev` on 5174, and `pnpm --filter @repo/web build`
then `start` serve the built app there; both read the root `.env.local`, then
`.env`. `next build` must list `/library*` and `/app/*` as `ƒ`, never `◐`: a
partial prerender writes its shell's scripts without the nonce. This app's
suites are three vitest projects (`vitest.config.ts`): `site`, under node, and
the tab's `library` (node, `*.test.ts`) and `library-dom` (jsdom,
`*.test.tsx`), compiled by the React Compiler as it ships. `generate` runs
`next typegen`, whose route types the app's program, its `typecheck` and the
root's lint read.

## Invites

Minting an invite is a row, deliberately: no admin page, no self-serve
issuance. Locally `pnpm db:seed` writes `DEV-INVITE`, and another is an
`invite_code` row added in `pnpm --filter @repo/db studio`; in production, a
row inserted in the Supabase project's SQL editor, its code 6 to 64 letters,
digits or dashes:

```sql
insert into invite_code (code) values ('...');
```
