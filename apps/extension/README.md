# @repo/extension — the browser's Save

The Chromium extension (Chrome, Arc, Brave, Edge, Vivaldi): a toolbar button
and a right-click Save that read the page you're on and save it to your
Inteligir library over `/v1`, under the browser's own sign-in to the site, so a
save needs no app open and signing out on the site signs it out too. The
site's `/connect/extension` page tells it which site to save to, it reads the page
with `@repo/page-reader`, and it keeps a save the cloud did not answer, or made
while signed out, until it can land.

## The build

WXT builds it from `src/entrypoints/` (`wxt.config.ts`). `pnpm --filter
@repo/extension build` (`wxt build`) writes the dev build to
`.output/chrome-mv3`, which Chrome loads unpacked: `manifest.json` (WXT's,
checked against `src/manifest.ts`), the popup and welcome pages, the
`background.js` service worker and the `capture.js` script `executeScript`
injects (an unlisted script, one IIFE). A build's flavor is its mode: `wxt` and
`wxt build` carry the committed key, ride a local Worker's sign-in on
`localhost` and may script `127.0.0.1`; `--mode store` rides inteligir.com's
alone. `pnpm package:extension` (`NODE_ENV=production wxt zip
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
src/entrypoints/welcome/          the page an install and Options open: whose library it saves to, or where to sign in
src/background/connection.ts      the account and the cloud, kept in storage, and the connect page's messages
src/background/sign-in.ts         the browser's session cookie for the cloud, and whose it is
src/background/listeners.ts       who the worker hears: its own pages and the one connect page
src/background/cloud.ts           the /v1 calls, their deadline and what a call missed by
src/background/save-page.ts       a tab, a link or a picture saved
src/background/save-queue.ts      how a try settles a save, a save that waits, and the one pass that sends it
src/background/capture-tab.ts     the capture injected, and a cover's bytes fetched
src/background/menus.ts           what each right-click item saves
src/capture/                      the capture's clone of the page and the shape it answers
src/messages.ts                   what the pages ask the worker, and its answers
src/outcome-copy.ts               what the popup and the badge say of how a save went
```

The pages ask the worker, and the worker asks the cloud. `pnpm
dev:extension` (`docs/development.md` § Browser extension) runs `wxt`, which
rebuilds `.output/chrome-mv3-dev` and reloads the extension on every change;
`pnpm --filter @repo/extension test` runs the suites under `WxtVitest()`, the
worker's under node with no DOM, the pages' under jsdom and compiled as they
ship, and `pnpm e2e --only
browser-extension` loads the dev build in a real Chromium against a booted
Worker.
