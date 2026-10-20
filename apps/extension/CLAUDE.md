# Decisions: @repo/extension

The browser extension: what it captures, what it may reach, and its wire to the
Mac. `AGENTS.md` § Decisions says how a bullet is written and cited.

## Browser extension

- **THE EXTENSION CAPTURES, THE MAC EXTRACTS.** A save sends the rendered DOM,
  cloned in the page's isolated world: no script but `application/ld+json`, no
  form value, typed or prefilled, every rich text box emptied, each image at its
  `currentSrc`, a `<base>` at the page's own, and, for Keep a copy of the page,
  every readable and adopted sheet frozen in place; past
  `CAPTURE_HTML_MAX_CHARS` it sends none and the Mac reads the url. The capture,
  an unlisted IIFE importing only the wire's types, injects 3 KB, not zod.
  Rejected: Readability or defuddle in the page (a second extractor, on the Web
  Store's cadence and in every page's process, that must agree with the Mac's
  fill). `apps/extension/src/entrypoints/capture.ts`,
  `apps/extension/src/capture/serialize-page.ts`, `freeze-styles.ts`.

- **A PAGE THE BROWSER WILL NOT SCRIPT IS SAVED BY ITS ADDRESS**, and a
  right-clicked selection on one by Chrome's own reading of it, for the Mac to
  place. `apps/extension/src/background/save-tab.ts`.

- **ACTIVETAB, NEVER `<all_urls>`.** The store builds ask `activeTab`,
  `contextMenus`, `nativeMessaging` and `scripting` and no host: the click on
  the toolbar, the shortcut or a menu grants the one tab every save is made
  over. Only the dev build adds the loopback hosts, so the e2e scripts its
  fixture page without a click, and the store zip refuses a manifest carrying
  one, or `<all_urls>` anywhere. There is no `externally_connectable`, and the
  worker answers only the extension's own pages, so no web page can ask it
  anything. Rejected: `<all_urls>` (an install warning that every page is
  readable at any time, for a save that only follows a click).
  `apps/extension/src/manifest.ts`,
  `apps/extension/src/entrypoints/background.ts`.

- **ONE `connectNative` PER SAVE.** Each request opens its own port, posts
  once, takes the first reply and closes, and Chrome's sentences as a port
  closes read as no app (`…not found.`), a door for another extension
  (`…forbidden.`) or a crash. Rejected: one port held for the worker's life (a
  host process running for nothing, dying with the worker MV3 stops anyway, and
  the old app's process after an update).
  `apps/extension/src/background/ask-host.ts`.

- **THE ID IS THE COMMITTED KEY'S, AND THE STORE ZIP STRIPS IT.** The dev build
  and the unpacked store build carry `EXTENSION_PUBLIC_KEY`, so their id is
  Chrome's derivation of it, known before any store listing and the door's one
  allowed origin; the zip carries no key, since the Web Store signs the item
  with its own, whose public half the owner commits once in its place
  (`docs/releasing.md`). The dev build dials `com.inteligir.desktop.dev`, which
  `inteligir native-host --install` writes for a checkout, and the store builds
  `com.inteligir.desktop`, which the app writes, so neither reaches the other's
  server. `packages/contract/src/browser/extension-identity.ts`,
  `apps/extension/wxt.config.ts`.

- **THE WIRE IS /browser, VERSIONED AND LENIENT.** The extension ships on the
  Web Store's cadence and the app on its own, so their wire is its own: plain
  `z.object`s that drop the unknown, a refusal reason either end never heard of
  read as `failed`, and each message's `v` read before its shape, a peer above
  `BROWSER_WIRE_VERSION` told to update the app and one below
  `BROWSER_WIRE_FLOOR` the extension. The host adapts it to `/local`, which
  breaks freely, and never touches the library; a page never names what the
  host keeps, since image bytes are saved only under a media type the library
  serves as a picture. The extension reaches `@repo/contract/browser/*` and
  `@repo/contract/cloud/origin` alone (`BROWSER_WIRE_CLIENTS` in
  `tools/repo-guards/src/dep-dag.test.ts`).
  `packages/contract/src/browser/browser-wire.ts`,
  `apps/cli/src/native-host/host-requests.ts`.

- **WXT BUILDS IT, AS kyh/init BUILDS ITS EXTENSION** (owner decision).
  `src/entrypoints/` holds the module worker, the popup, and the unlisted
  welcome page and capture script, every page under the React Compiler and in
  `StrictMode`; `wxt` is the reloading dev loop, `wxt build` the dev build,
  `wxt zip --mode store` the store's. WXT takes `extensionManifest`, a function
  of the flavor (the mode), and fails a build whose manifest differs, so the
  tests call what ships; the paths the worker injects and opens are typed
  `PublicPath`s. Rejected: a plain Vite build (two configs, a manifest plugin
  and two unreloading watches kept in step by hand, beside the template's
  shape, to save one framework's cadence); CRXJS (a second framework, no
  template). `apps/extension/wxt.config.ts`.

- **THREE THINGS kyh/init HAS NO NEED OF: A PRODUCTION ZIP, A HOOK THAT CHECKS
  IT, AND `chrome.*`.** The zip runs under `NODE_ENV=production`, since WXT sets
  NODE_ENV to the mode and `--mode store` alone ships React's development build.
  The zip's hook refuses any other flavor, checks the store manifest and the
  zip's file list, and writes the unpacked store build beside it. The worker
  calls `chrome.*` under `@types/chrome` rather than WXT's `browser`, which on
  Chromium, the one browser it ships to, is `chrome`.
  `apps/extension/package.json`, `apps/extension/wxt.config.ts`.
