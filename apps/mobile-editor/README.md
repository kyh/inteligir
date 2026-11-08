# @repo/mobile-editor — the phone's editor page

The desktop's editor (`@repo/editor`), built as one page the phone opens in a
WebView. `@repo/mobile` is React Native under Metro and TypeScript 6 and may
reach the `/v1` wire, `@repo/domain`, `@repo/notes`,
`@repo/agent-panel` and the page's wire, `@repo/editor-bridge`; the editor is DOM React under Vite, the React Compiler and
TypeScript 7. Expo DOM components were rejected: they compile the editor a
second way (Metro and babel) and typecheck it under the phone's TypeScript. A
separate Vite page keeps the toolchain the editor's own tests run.

The page shows ONE item for its whole life, by its id, under the touch
profile (`EditorProfileProvider`, so the touch kit, its locked rich blocks and
the keyboard toolbar), over the account's library on the other end of the
bridge: the editor holds the item's blocks under their ids
(`@repo/editor/item/item-editor`), and a pause writes what changed as ops, each
under the hash or value it was computed from (`src/item/item-page.tsx`,
`src/item/item-host.ts`). A link names its item by id, shows the name that item
goes by now, and opens it through the native stack. While the phone has no
connection the editor is read-only and says "Needs a connection", and an edit
the drop caught is written once it is back. The `/v1` calls, the file cache
and the navigation stack stay native.

## The build

`pnpm --filter @repo/mobile-editor build` writes `dist/`: `index.html`, ONE
classic `<script defer>` and one stylesheet, relative to the page. A `file://`
page in WKWebView loads no module script and no `crossorigin` tag
(`vite/classic-page.ts` says why), so the build is one IIFE with every dynamic
import inlined (pele, katex, the calendar, the wiki chip), and
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
  holds it, or as the phone last read it while offline, each block with its
  hash and place), `writeItem` (ops under their bases, answered queued,
  unchanged, missing, changed with the item as it reads now, invalid, or
  waiting on a body still to come), `linkTargets` (the
  items a link can name, by id and
  the title each goes by now, asked again whenever another item moves),
  `readFile` (a file a note names, by its sha, from the phone's file cache,
  which fetches it the first time, as the type it was kept or served as; none
  while the phone can reach no copy),
  `keepFile` (a file pasted into the text, sent up to the library and
  answered with its sha),
  `createNote` (a note of blocks an extract
  moved, or a link's new note, made in the open item's folder and answered
  with its id) — and events:
  `editorState` (why a write failed, sent only when that changes, which the
  screen asks about before letting the item go), `openItem` (the page has
  written what it holds and asks the stack to open the item a link names),
  `flushed`.
- Native to page: `init { nonce, itemId, focus, fileMaxBytes, online }`,
  `response { id, ok }`, `itemChanged { ids, reset, overlapped }` (the library
  moved; the page reads its item again when it is among them), `connection
  { online }` (the phone's connection came or went), and `flush` (answered by
  `flushed` with its id). The page follows the phone's appearance through
  `prefers-color-scheme`, so no frame carries a theme.

The native end is `apps/mobile/src/editor/editor-host.ts`, answering over the
account's library through `item-ports.ts`. Native reaches the page ONLY by
`injectJavaScript` of
`nativeFrameScript(frame)`, which calls the door `connectPageBridge` installs
on `window`, non-writable and non-configurable (`src/bridge/page-bridge.ts`):
a message event is one a child frame's `parent.postMessage` could forge. The
first well-formed `init` sets the nonce; a frame without it, or with another
load's, is dropped, as is anything malformed. A file's read and its keep wait
as long as the phone takes, since they take as long as the download or the
copy across the bridge; every other request times out after `REQUEST_TIMEOUT_MS` (a write names its
bases, so its retry finds what landed). An answer is parsed by the kind it
answers.

`src/item/item-host.ts` builds the editor's host over the bridge: the item
store the session reads and writes, its link-resolver store fed by the
targets, and the `EditorHostIo` and `EditorHostActions` it installs as one
host when the page starts; a bound formula reads the items it names through
the same store.

## Layout

```
index.html              the page, its CSP and a scale-1 viewport
vite.config.ts          one IIFE, fonts inlined, the classic-page check
vite/classic-page.ts    the entry rewrite and the build's refusal
src/
  main.tsx              connects the bridge, waits for init, mounts the item
  bridge/page-bridge.ts correlation, timeouts, the nonce, the window door
  item/item-page.tsx    one item's editor by its id, under the touch profile
  item/item-host.ts     its store over the bridge, its links by id, its flush
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
under their block hashes. The suites cover correlation, timeouts and every
dropped frame (`src/bridge/page-bridge.test.ts`), an item page whose pause
reaches the phone as ops under their bases, settled again over a changed item,
and read-only with no connection, compiled like the shipped page
(`src/item/item-page.test.tsx`).
`vite/classic-page.test.ts` pins the build's verdicts. The page in a real
browser from `file://`, with a scripted phone on its bridge, is
`tools/e2e/src/scenarios/phone-editor-page.ts`.
