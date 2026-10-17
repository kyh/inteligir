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
