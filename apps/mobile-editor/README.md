# @repo/mobile-editor — the phone's editor page

The desktop's editor (`@repo/editor`), built as one page the phone opens in a
WebView. `@repo/mobile` is React Native under Metro and TypeScript 6 and may
reach the `/v1` wire and the library model (`@repo/contract`),
`@repo/agent-panel` and the page's wire, `@repo/editor-bridge`; the editor is DOM React under Vite, the React Compiler and
TypeScript 7. Expo DOM components were rejected: they compile the editor a
second way (Metro and babel) and typecheck it under the phone's TypeScript. A
separate Vite page keeps the toolchain the editor's own tests run.

The page shows ONE item for its whole life, by its id, under the touch
profile (`EditorProfileProvider`, so the touch kit and its locked rich
blocks), over the account's library on the other end of the bridge: it draws
the blocks the phone holds of the item read-only
(`@repo/editor/item/held-item`), says that editing on the phone is coming,
and draws them again as the item moves (`src/item/item-page.tsx`,
`src/item/item-host.ts`). A link names its item by id, shows the name that item
goes by now, and opens it through the native stack. The `/v1` calls, the file
cache and the navigation stack stay native.

## The build

`pnpm --filter @repo/mobile-editor build` writes `dist/`: `index.html`, ONE
classic `<script defer>` and one stylesheet, relative to the page. A `file://`
page in WKWebView loads no module script and no `crossorigin` tag
(`vite/classic-page.ts` says why), so the build is one IIFE with every dynamic
import inlined (pele, katex, the calendar), and
`vite/classic-page.ts` rewrites vite's entry tag and FAILS the build on a
module script, a second script or chunk, a `crossorigin` tag or a
modulepreload link. Every woff2 is inlined into the
stylesheet. `index.html` carries a static CSP of its own: `connect-src 'none'`,
since the page reaches nothing and the bridge is its only way out, no worker,
no frame but its own, and no `frame-ancestors`, which a meta tag cannot carry. There
is no dev server: the CSP refuses the inline script a Vite dev page injects, and
the page means nothing without a native end.

## The bridge

The wire is `@repo/editor-bridge` (`packages/editor-bridge/src/protocol.ts`),
a package of its own so the native end parses the same frames without
reaching this one. Both ends ship in one binary, so it breaks
freely: no version field. Every frame is the JSON text of one, parsed by the
end that receives it.

- Page to native: `ready` (the door is installed; it knows no nonce yet), then
  requests `{ id, nonce, kind, payload }` — `item` (the item as the library
  holds it, or as the phone last read it while offline, its blocks in order,
  each in its section), `linkTargets` (the items a link can name, by id and
  the title each goes by now, asked again whenever another item moves), and
  `readFile` (a file a note names, by its sha, from the phone's file cache,
  which fetches it the first time, as the type it was kept or served as; none
  while the phone can reach no copy) — and the event `openItem` (the stack
  opens the item a link names).
- Native to page: `init { nonce, itemId }`, `response { id, ok }`, and
  `itemChanged { ids, reset }` (the library moved; the page reads its item
  again when it is among them). The page follows the phone's appearance
  through `prefers-color-scheme`, so no frame carries a theme.

The native end is `apps/mobile/src/editor/editor-host.ts`, answering over the
account's library through `item-ports.ts`. Native reaches the page ONLY by
`injectJavaScript` of
`nativeFrameScript(frame)`, which calls the door `connectPageBridge` installs
on `window`, non-writable and non-configurable (`src/bridge/page-bridge.ts`):
a message event is one a child frame's `parent.postMessage` could forge. The
first well-formed `init` sets the nonce; a frame without it, or with another
load's, is dropped, as is anything malformed. A file's read waits as long as
the phone takes, since it takes as long as the download or the copy across
the bridge; every other request times out after `REQUEST_TIMEOUT_MS`. An
answer is parsed by the kind it answers.

`src/item/item-host.ts` builds the editor's host over the bridge: the
library's titles it hands the editor, an embed's and a bound formula's blocks
read by the item they name, a note's files, and the `EditorHostIo` and
`EditorHostActions` it installs as one host when the page starts. The page
takes no edit, so the host dials no note, keeps no file and makes no note.

## Layout

```
index.html              the page, its CSP and a scale-1 viewport
vite.config.ts          one IIFE, fonts inlined, the classic-page check
vite/classic-page.ts    the entry rewrite and the build's refusal
src/
  main.tsx              connects the bridge, waits for init, mounts the item
  bridge/page-bridge.ts correlation, timeouts, the nonce, the window door
  item/item-page.tsx    one item's blocks by its id, read-only, under the touch
                        profile
  item/item-host.ts     the editor's host over the bridge, its links by id
  styles/globals.css    @repo/ui's and @repo/editor's sheets, and the page's
                        own values for the dials (--editor-size at 16px or
                        more, or iOS zooms)
```

## Testing

```bash
pnpm --filter @repo/mobile-editor test
```

`src/test-support/fake-phone.ts` is the native end as the page sees it: a
transport that records frames and answers from an in-memory library of items
and files. The suites cover correlation, timeouts and every dropped frame
(`src/bridge/page-bridge.test.ts`), and an item page drawn read-only from what
the phone holds, drawn again as it moves, gone or unreachable, compiled like
the shipped page (`src/item/item-page.test.tsx`).
`vite/classic-page.test.ts` pins the build's verdicts. The page in a real
browser from `file://`, with a scripted phone on its bridge, is
`tools/e2e/src/scenarios/phone-editor-page.ts`.
