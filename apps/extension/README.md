# @repo/extension — the browser's Save

The Chromium extension (Chrome, Arc, Brave, Edge, Vivaldi): a toolbar button
and a right-click Save that read the page you're on and save it to your
Inteligir library over `/v1`, with a device credential of its own, so a save
needs no app open. It connects to an account through the site's
`/connect/extension` page, reads the page with `@repo/page-reader`, and keeps a
save the cloud did not answer until it does.

## The build

WXT builds it from `src/entrypoints/` (`wxt.config.ts`). `pnpm --filter
@repo/extension build` (`wxt build`) writes the dev build to
`.output/chrome-mv3`, which Chrome loads unpacked: `manifest.json` (WXT's,
checked against `src/manifest.ts`), the popup and welcome pages, the
`background.js` service worker and the `capture.js` script `executeScript`
injects (an unlisted script, one IIFE). A build's flavor is its mode: `wxt` and
`wxt build` carry the committed key, connect from a local Worker on
`localhost` and may script `127.0.0.1`; `--mode store` connects from
inteligir.com alone. `pnpm package:extension` (`NODE_ENV=production wxt zip
--mode store`) writes the Web Store zip,
`.output/inteligir-extension-<version>.zip`, after checking it, and the
unpacked store build beside it at `.output/chrome-mv3-store-unpacked`.
`wxt prepare` (the `generate` task) writes `.wxt/`, the tsconfig and types the
program extends.

## The pieces

```
wxt.config.ts                     the build: the manifest, the store zip's checks
worker-conditions.ts              how the worker's bundle and its suites resolve a package
src/manifest.ts                   the MV3 manifest, one function of the build's flavor
src/entrypoints/background.ts     the service worker: its listeners, the menus, the badge
src/entrypoints/capture.ts        the script executeScript injects: the rendered DOM, cloned
src/entrypoints/popup/            the toolbar's popup: the save and how it went
src/entrypoints/welcome/          the page an install, the popup and Options open: the account and Disconnect, or Connect
src/background/connection.ts      the credential, kept in storage, and the connect page's messages
src/background/listeners.ts       who the worker hears: its own pages and the one connect page
src/background/cloud.ts           the /v1 calls, their deadline and what a failure means
src/background/save-page.ts       a tab, a link or a picture saved
src/background/save-queue.ts      a save that waits, and the alarm that sends it
src/background/capture-tab.ts     the capture injected, and a cover's bytes fetched
src/background/menus.ts           what each right-click item saves
src/capture/                      the capture's clone of the page and the shape it answers
src/messages.ts                   what the pages ask the worker, and its answers
src/outcome-copy.ts               every sentence the popup, the welcome page and the badge say
```

The pages ask the worker, and the worker asks the cloud. `pnpm
dev:extension` (`docs/development.md` § Browser extension) runs `wxt`, which
rebuilds `.output/chrome-mv3-dev` and reloads the extension on every change;
`pnpm --filter @repo/extension test` runs the suites under `WxtVitest()`, the
worker's under node with no DOM, the pages' under jsdom and compiled as they
ship, and `pnpm e2e --only
browser-extension` loads the dev build in a real Chromium against a booted
Worker.
