# @repo/extension — the browser's Save

The Chromium extension (Chrome, Arc, Brave, Edge, Vivaldi): a toolbar button
and a right-click Save that capture the page you're on and hand it to the
Inteligir Mac app on the same machine, through `inteligir native-host`. It
never talks to the network, the account or the library itself: the host it
dials adapts the versioned `/browser` wire (`@repo/contract/browser`) to the
running app's `/local`, and the app reads, fills and files the page.

## The build

`pnpm --filter @repo/extension build` writes the dev build to `dist/`, which
Chrome loads unpacked: `manifest.json` (emitted from `src/manifest.ts`), the
popup and welcome pages, the `background.js` service worker and the
`capture.js` script `executeScript` injects (its own IIFE build,
`vite.capture.config.ts`). A build's flavor is its Vite mode: `--mode dev`
dials `com.inteligir.desktop.dev` and carries the committed key and the
loopback hosts, `--mode store` dials `com.inteligir.desktop`.
`pnpm package:extension` writes the Web Store zip and the unpacked store build
under `.output/`.

## The pieces

```
src/manifest.ts              the MV3 manifest, one function of the build's flavor
src/background/background.ts the service worker: the menus, the pages' requests, the badge
src/background/ask-host.ts   one connectNative per request, Chrome's errors as reasons
src/background/save-tab.ts   a tab's capture, and the save it asks for
src/background/menus.ts      what each right-click item saves
src/capture/                 the script executeScript injects: the rendered DOM, cloned
src/popup/                   the toolbar's popup: the save, Keep a copy of the page, Open Inteligir
src/welcome/                 the page an install opens: which library it reached
src/messages.ts              what the pages ask the worker, and its answers
src/outcome-copy.ts          every sentence the popup, the welcome page and the badge say
```

The pages ask the worker, the worker asks the host, and the host asks the app:
the wire to the host is `@repo/contract/browser`, versioned on its own, and the
extension imports nothing else of the contract but the production origin its
download link names. `pnpm dev:extension` (`docs/development.md` § Browser
extension) writes this checkout's door and rebuilds `dist/` on every change;
`pnpm --filter @repo/extension test` runs the suites under jsdom, the pages
compiled as they ship, and `pnpm e2e --only browser-extension` loads the dev
build in a real Chromium against a running app.
