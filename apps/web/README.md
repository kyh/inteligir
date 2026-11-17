# `@repo/web` — inteligir.com

The one Next.js app, on its App Router: the site, the library tab at
`/library`, and the cloud's routes over `@repo/service` and `@repo/db`. Its
decisions are this app's [`CLAUDE.md`](CLAUDE.md), and the library tab's
[`src/library/CLAUDE.md`](src/library/CLAUDE.md).

## Layout

```
src/
  app/           the App Router's layouts, pages and route handlers; (marketing)/ the site's pages
  library/       the library tab: its code, styles and decisions, its suites under jsdom
  components/    the site's own components
  lib/           the site's auth client, document policy, config and page markdown
next.config.ts   Cache Components, the React Compiler, `?raw`
```

## Routes

| Route                                      | What                                              |
| ------------------------------------------ | ------------------------------------------------- |
| `/`, `/about`, `/contact`                  | the site's pages, prerendered                     |
| `/privacy`, `/terms`                       | `docs/privacy.md` and `docs/terms.md`, rendered   |
| `/app`                                     | a 307 to `/library`                               |
| `/llms.txt`, `/robots.txt`, `/sitemap.xml` | for agents and crawlers                           |
| `/api/markdown/*`                          | a page's markdown; no public address              |
| `/api/health`                              | `{"ok":true}` once the database answers, else 503 |
| `/api/*`                                   | a JSON 404                                        |

The library tab's code is here, but no page mounts it yet: its suites draw it
over memory.

## Testing and the dev loop

`pnpm dev:web` runs `next dev` on 5174, and `pnpm --filter @repo/web build`
then `start` serve the built app there; both read the root `.env.local`, then
`.env`. This app's suites are three vitest projects (`vitest.config.ts`):
`site`, under node, and the tab's `library` (node, `*.test.ts`) and
`library-dom` (jsdom, `*.test.tsx`), compiled by the React Compiler as it
ships. `typecheck` runs `next typegen`, then the app's program.
