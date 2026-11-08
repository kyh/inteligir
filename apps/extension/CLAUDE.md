# Decisions: @repo/extension

The browser extension: how it connects to an account, what it reads of a page,
how it saves and waits, what it may reach, and how it builds. `AGENTS.md` §
Decisions says how a bullet is written and cited.

## Browser extension

- **THE EXTENSION IS A `/v1` CLIENT WITH A DEVICE CREDENTIAL OF ITS OWN, HANDED
  OVER BY THE SITE'S CONNECT PAGE.** Signed in there, a click mints it a
  credential for the session's account (`account.connectExtension`, refused to
  a device's bearer) and sends it through `externally_connectable` to the one
  id the committed key names; the manifest lets that page message it and no
  other extension, the worker checks the sender's origin exactly and parses
  the message before it keeps anything, and the page's origin becomes the
  cloud it calls. A credential the extension did not take, or one it replaces,
  is revoked. Rejected: a password typed into the extension (a second sign-in
  form, on the Web Store's cadence); the Mac's app as its door (no save with
  the Mac closed). `apps/extension/src/background/connection.ts`,
  `apps/extension/src/background/listeners.ts`,
  `apps/web/src/lib/extension-connect.ts`.

- **THE EXTENSION READS THE PAGE ITSELF, OVER THE DOM THE PERSON SEES, AND SAVES
  IT READ.** The capture clones the rendered DOM in the page's isolated world:
  no script but `application/ld+json`, no form value or choice, typed or
  prefilled, every rich text box emptied, each image at its `currentSrc` alone,
  a `<base>` at the page's own; past `CAPTURE_HTML_MAX_CHARS` (2 MB) it sends
  none. The worker reads the clone with `@repo/page-reader` over linkedom, the
  host with no DOM of its own, and calls `items.save` with the article, the
  facts and a cover it could read, put by its sha. A page it cannot script,
  or read no text from, is saved as its link for the cloud's fill, since an
  item saved read is never filled, and so is one whose reading the cloud refuses as a call, since the
  address may land where the reading could not. Rejected: an offscreen
  document for `DOMParser` (a second context and a permission, for the DOM
  linkedom already gives the cloud's fill); the reader injected into the page
  (a megabyte parsed into every saved page).
  `apps/extension/src/background/save-page.ts`,
  `apps/extension/src/capture/serialize-page.ts`.

- **A SAVE IS QUEUED BEFORE ITS FIRST CALL, AS ITS ADDRESS AND TITLE, AND AN
  ALARM SENDS WHAT WAITS.** One `storage.local` key a save, so two at
  once never write over each other; a save the cloud did not answer is sent
  again as `items.saveLink` under its own ids, every 30 s by an alarm made as
  the save is kept and again at every start, the browser's included, while one
  waits, and the popup says "Saved when you're back online". A first try whose
  worker stopped mid-call is resent only once past the longest its page can
  take to land (its cover fetches and two calls, each to its deadline), since a
  link landing under its op id first would stand in for its page. A waiting save the cloud
  refuses as too old a build waits for the browser's update, which
  `storage.local` outlives; any other refusal lets it
  go, a full library too, which only the person can empty; a revoked
  credential forgets the connection and every save made under it, unless a
  connect replaced it while the call was on its way, since that refusal
  answers for the old one and never the one just handed over. Rejected: the
  page's HTML in the queue (2 MB a save in a 10 MB store); a timer (the worker
  dies 30 s after its last event).
  `apps/extension/src/background/save-queue.ts`.

- **THE CREDENTIAL AND THE QUEUE ARE STORAGE'S, AND THE WORKER HOLDS NOTHING.**
  `storage.local` is opened to trusted contexts alone as the worker starts, so
  the capture script it injects into a page reads neither; every listener is
  registered in `main()`'s first turn, an async answer returns `true`, and
  every call has a deadline under the 30 s a worker waits on a fetch.
  `apps/extension/src/entrypoints/background.ts`.

- **ACTIVETAB, NEVER `<all_urls>`.** The store builds ask `activeTab`,
  `alarms`, `contextMenus`, `scripting` and `storage` and no host: the click
  on the toolbar, the shortcut or a menu grants the one tab every save is made
  over. The cloud answers CORS for the extension's exact origin
  (`apps/web/src/worker/cors.ts`), so a call needs no host; a cover on another
  site is kept only where it lets the extension read it, else the item has
  none. Only the dev build adds `127.0.0.1`, so the e2e scripts its fixture
  page without a click, and the store zip refuses a manifest carrying a host,
  `<all_urls>` or a connect page but production's. Rejected: `<all_urls>` (an
  install warning that every page is readable at any time, for a save that
  only follows a click); the cloud's origin as a host (a second spelling of
  what CORS answers). `apps/extension/src/manifest.ts`.

- **THE BUILD FLOOR HOLDS THE EXTENSION AS IT HOLDS EVERY CLIENT.** Every call
  names its build (`<version>+extension`) and its version is the product's
  (`tools/repo-guards/src/release-versions.test.ts`), so the one
  `MIN_CLIENT_BUILD` refuses an extension below it as it refuses a Mac or a
  phone, and the popup says to update it. Rejected: a version of its own (the
  floor would refuse it, or need a second floor per platform).
  `apps/extension/src/background/cloud.ts`.

- **THE ID IS THE COMMITTED KEY'S, AND THE STORE ZIP STRIPS IT.** The dev build
  and the unpacked store build carry `EXTENSION_PUBLIC_KEY`, so their id is
  Chrome's derivation of it, known before any store listing: the origin the
  cloud answers CORS for and the id the connect page sends to. The zip carries
  no key, since the Web Store signs the item with its own, whose public half
  the owner commits once in its place (`docs/releasing.md`).
  `packages/contract/src/cloud/extension/extension-identity.ts`,
  `apps/extension/wxt.config.ts`.

- **WXT BUILDS IT, AS kyh/init BUILDS ITS EXTENSION** (owner decision).
  `src/entrypoints/` holds the module worker, the popup, and the unlisted
  welcome page and capture script, every page under the React Compiler and in
  `StrictMode`; `wxt` is the reloading dev loop, `wxt build` the dev build,
  `wxt zip --mode store` the store's. WXT takes `extensionManifest`, a function
  of the flavor (the mode), and fails a build whose manifest differs, so the
  tests call what ships. Every module imports what it uses (`imports: false`),
  the program extends `.wxt/tsconfig.json`, which `wxt prepare` writes as the
  `generate` task the typecheck and the suites wait on, and the suites run
  under `WxtVitest()`. The build resolves a package's `worker` export first,
  since the worker shares the pages' chunks and has no DOM, and the worker's
  suites run under node with the same conditions, the pages' under jsdom, so
  no worker suite passes on a DOM the worker lacks. Rejected: a plain Vite
  build (two configs and a manifest plugin kept in step by hand); CRXJS (a
  second framework, no template); one jsdom run (the reader takes a fallback
  there that the worker never takes). `apps/extension/wxt.config.ts`,
  `apps/extension/vitest.config.ts`.

- **`browser.*` AT CHROME 148, AND A PRODUCTION ZIP THAT CHECKS ITSELF**
  (owner decision). From Chrome 148 every API is under `browser`, so the
  extension calls WXT's `browser` alone, at `minimum_chrome_version` 148; Arc
  on that Chromium is an owner check (`docs/releasing.md` § 5). The zip runs
  under `NODE_ENV=production`, since WXT sets NODE_ENV to the mode, and its
  hook refuses any other flavor, checks the store manifest and the zip's file
  list, and writes the unpacked store build beside it. Rejected: `chrome.*`
  under `@types/chrome` (a second spelling of every API).
  `apps/extension/package.json`, `apps/extension/wxt.config.ts`.

- **NO COPY OF THE PAGE: AN ITEM KEEPS WHAT THE EXTENSION READ, AND OPEN
  ORIGINAL OPENS THE PAGE.** `items.save` carries the article, the facts and
  a cover, never a copy. Rejected: Keep a copy on `items.save` (no
  device opens a copy, so it would upload bytes nobody reads; a single-file
  copy needs every stylesheet, font and picture the page names, which an
  `activeTab` extension with no host cannot fetch across origins; the frozen
  DOM alone could spend the capture's 2 MB). `apps/extension/src/background/save-page.ts`.

- **DISCONNECT IS THE WELCOME PAGE'S, AND THAT PAGE CAN ALWAYS BE OPENED AGAIN.**
  The install opens it once; the popup links it as Manage connection while
  connected, and the manifest names it `options_ui`, in a tab, so the toolbar
  button's own Options reaches it when the popup could read no connection.
  Rejected: Disconnect in the popup (it saves as it opens, and one stray click
  there would forget what waits); a message from the site that disconnects (a
  page could then sign a browser out, on a door that only hands a credential
  over). `apps/extension/src/manifest.ts`,
  `apps/extension/src/entrypoints/popup/app.tsx`,
  `apps/extension/src/entrypoints/welcome/app.tsx`.
