# Decisions: @repo/extension

The browser extension: what it captures, what it may reach, and its wire to the Mac.
`AGENTS.md` § Decisions says how a bullet is written and cited.

## Browser extension

- **THE EXTENSION CAPTURES, THE MAC EXTRACTS.** A save sends the rendered DOM,
  cloned in the page's isolated world: no script but structured data
  (`application/ld+json`), no form value typed or prefilled and every rich text
  box (`contenteditable`, `role="textbox"`) emptied, each image at the
  `currentSrc` the browser chose, a `<base>` at the page's own base, and, for
  Keep a copy of the page, every readable sheet's CSSOM rules and adopted sheets
  frozen in place; past `CAPTURE_HTML_MAX_CHARS` it sends none and the Mac reads
  the url. The page is never read here. Rejected: Readability (or defuddle) in
  the page, a second extractor shipped on the Web Store's cadence that would
  have to agree with the Mac's fill, inside every page's process. The capture is
  its own IIFE build importing the wire's types alone, so a page is injected
  2 KB rather than zod (the worker hands it the cap). A page the browser will
  not script is saved by its address, and a right-clicked selection on one by
  Chrome's own reading of it for the Mac to place.
  `apps/extension/src/capture/serialize-page.ts`, `freeze-styles.ts`.

- **ACTIVETAB, NEVER `<all_urls>`.** The store builds ask `activeTab`,
  `contextMenus`, `nativeMessaging` and `scripting` and no host: a click on the
  toolbar, the shortcut or a menu grants the one tab it was made over, which is
  every tab a person saves. Rejected: `<all_urls>`, an install warning that every
  page is readable at any time, for a save that only ever follows a click. Only
  the dev build adds the loopback hosts, so the e2e scripts its fixture page
  without a click, and `scripts/package.ts` refuses a store manifest that
  carries one. There is no `externally_connectable`, and the worker answers only
  the extension's own pages, so no web page can ask it anything.
  `apps/extension/src/manifest.ts`, `apps/extension/src/background/background.ts`.

- **ONE `connectNative` PER SAVE.** Each request opens its own port, posts once,
  takes the first reply and closes, and Chrome's sentences as a port closes read
  as no app (`…not found.`), a door for another extension (`…forbidden.`) or a
  crash. Rejected: one port held for the worker's life, which keeps a host
  process running for nothing, dies with the worker MV3 stops anyway, and is the
  old app's process after an update. `apps/extension/src/background/ask-host.ts`.

- **THE ID IS THE COMMITTED KEY'S, AND THE STORE ZIP STRIPS IT.** The dev build
  and the unpacked store build carry `EXTENSION_PUBLIC_KEY`, so their id is
  Chrome's derivation of it, known before any store listing, and the door's one
  allowed origin; the zip carries no key, since the Web Store signs the item
  with its own, whose public half the owner commits once in its place
  (`docs/releasing.md`). The dev build dials `com.inteligir.desktop.dev`, which
  `inteligir native-host --install` writes for a checkout, and the store builds
  `com.inteligir.desktop`, which the app writes, so neither reaches the other's
  server. `packages/contract/src/browser/extension-identity.ts`,
  `apps/extension/scripts/package.ts`.

- **THE WIRE IS /browser, VERSIONED AND LENIENT.** The extension ships on the
  Web Store's cadence and the app on its own, so the two speak a wire of their
  own: plain `z.object`s that drop what they do not know, a refusal reason
  either end never heard of read as `failed`, and every message's `v` read
  before its shape, a peer above `BROWSER_WIRE_VERSION` told to update the app
  and one below `BROWSER_WIRE_FLOOR` the extension. The host adapts it to
  `/local`, which breaks freely, and never touches the library itself; a page
  never names what the host keeps, since an image's bytes are saved only under
  a media type the library serves as a picture. The extension reaches
  `@repo/contract/browser/*` and `@repo/contract/cloud/origin` alone
  (`BROWSER_WIRE_CLIENTS` in `tools/repo-guards/src/dep-dag.test.ts`).
  `packages/contract/src/browser/browser-wire.ts`,
  `apps/cli/src/native-host/host-requests.ts`.

- **PLAIN VITE, NO EXTENSION FRAMEWORK.** The pages and the module worker are
  one Vite build under the React Compiler, the capture script a second IIFE
  build beside it, and the manifest a function of the flavor that a small plugin
  emits, so its tests call what ships. Rejected: WXT and CRXJS, a framework's
  manifest generation, dev server and reload for an extension of two pages, a
  worker and one script, on that framework's release cadence.
  `apps/extension/vite.config.ts`, `apps/extension/vite/extension-manifest.ts`.
