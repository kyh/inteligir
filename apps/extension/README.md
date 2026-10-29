# @repo/extension — the browser's Save

The Chromium extension (Chrome, Arc, Brave, Edge, Vivaldi): a toolbar button
and a right-click Save that capture the page you're on and hand it to the
Inteligir Mac app on the same machine, through `inteligir native-host`. It
never talks to the network, the account or the library itself: the host it
dials adapts the versioned `/browser` wire (`@repo/contract/browser`) to the
running app's `/local`, and the app reads, fills and files the page.

## The build

WXT builds it from `src/entrypoints/` (`wxt.config.ts`). `pnpm --filter
@repo/extension build` (`wxt build`) writes the dev build to
`.output/chrome-mv3`, which Chrome loads unpacked: `manifest.json` (WXT's,
checked against `src/manifest.ts`), the popup and welcome pages, the
`background.js` service worker and the `capture.js` script `executeScript`
injects (an unlisted script, one IIFE). A build's flavor is its mode: `wxt` and
`wxt build` dial `com.inteligir.desktop.dev` and carry the committed key and
the loopback hosts, `--mode store` dials `com.inteligir.desktop`.
`pnpm package:extension` (`NODE_ENV=production wxt zip --mode store`) writes the Web Store zip,
`.output/inteligir-extension-<version>.zip`, after checking it, and the
unpacked store build beside it at `.output/chrome-mv3-store-unpacked`.

## The pieces

```
wxt.config.ts                   the build: the manifest, the host it dials, the store zip's checks
src/manifest.ts                 the MV3 manifest, one function of the build's flavor
src/entrypoints/background.ts   the service worker: the menus, the pages' requests, the badge
src/entrypoints/capture.ts      the script executeScript injects: the rendered DOM, cloned
src/entrypoints/popup/          the toolbar's popup: the save, Keep a copy of the page, Open Inteligir
src/entrypoints/welcome/        the page an install opens: which library it reached
src/background/ask-host.ts      one connectNative per request, Chrome's errors as reasons
src/background/save-tab.ts      a tab's capture, and the save it asks for
src/background/menus.ts         what each right-click item saves
src/capture/                    the capture's clone of the page and its frozen styles
src/messages.ts                 what the pages ask the worker, and its answers
src/outcome-copy.ts             every sentence the popup, the welcome page and the badge say
```

The pages ask the worker, the worker asks the host, and the host asks the app:
the wire to the host is `@repo/contract/browser`, versioned on its own, and the
extension imports nothing else of the contract but the production origin its
download link names. `pnpm dev:extension` (`docs/development.md` § Browser
extension) writes this checkout's door, then runs `wxt`, which rebuilds
`.output/chrome-mv3-dev` and reloads the extension on every change;
`pnpm --filter @repo/extension test` runs the suites under jsdom, the pages
compiled as they ship, and `pnpm e2e --only browser-extension` loads the dev
build in a real Chromium against a running app.
