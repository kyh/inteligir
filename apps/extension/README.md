# @repo/extension — the browser's Save

The Chromium extension (Chrome, Arc, Brave, Edge, Vivaldi): a toolbar button
and a right-click Save that read the page you're on with `@repo/page-reader`
and save it to your library over `/v1`, under the browser's own sign-in to the
site, keeping a save the cloud did not answer until it lands. Its decisions are
this app's [`CLAUDE.md`](CLAUDE.md).

## Layout

```
wxt.config.ts        the build: the manifest, the store zip's checks
src/manifest.ts      the MV3 manifest, one function of the build's flavor
src/entrypoints/     the service worker, the injected capture script, the popup and the welcome page
src/background/      the worker's half: whose sign-in it rides, the /v1 calls, the save queue, the menus
src/capture/         the capture's clone of the rendered page
```

The pages ask the worker, and the worker asks the cloud.

## Testing and the dev loop

`pnpm dev:extension` runs WXT's dev loop, `.output/chrome-mv3-dev`, which
saves to `pnpm dev:web`'s Worker (`docs/development.md` § Browser extension).
`wxt build` writes the dev build the e2e loads; `pnpm package:extension`
(`--mode store`) writes the Web Store zip and the unpacked store build, which
ride inteligir.com's sign-in alone. `pnpm --filter @repo/extension test` runs
the worker's suites under node with no DOM and the pages' under jsdom, compiled
as they ship; `pnpm e2e -- extension` loads the dev build in a real Chromium
against a booted Worker.
