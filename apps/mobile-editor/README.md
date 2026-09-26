# @repo/mobile-editor — the phone's editor page

The desktop's editor (`@repo/editor`), built as one page the phone opens in a
WebView. `@repo/mobile` is React Native under Metro and TypeScript 6 and may
reach only `@repo/api/cloud`, `@repo/domain` and `@repo/notes`; the editor is
DOM React under Vite, the React Compiler and TypeScript 7. Expo DOM components
were rejected: they compile the editor a second way (Metro and babel) and
typecheck it under the phone's TypeScript. A separate Vite page keeps the
toolchain the editor's own tests run.

The page shows ONE note for its whole life, under the touch profile
(`EditorProfileProvider`, so the touch kit, its locked rich blocks and the
keyboard toolbar). Everything it reads or writes, and every navigation, is a
frame to the native screen that hosts it: the phone's store, its offline queue
and its navigation stack stay native.

## The build

`pnpm --filter @repo/mobile-editor build` writes `dist/`: `index.html`, ONE
classic `<script defer>` and one stylesheet, relative to the page. WKWebView
fetches a module script, and any tag marked `crossorigin`, in CORS mode, and a
`file://` page has no origin to answer one with (vitejs/vite#14483), so the
build is one IIFE with every dynamic import inlined (mermaid, katex, the
calendar, the wiki chip), and `vite/classic-page.ts` rewrites vite's entry tag
and FAILS the build on a module script, a second script or chunk, a
`crossorigin` tag or a modulepreload link. Every woff2 is inlined into the
stylesheet. `index.html` carries a static CSP, `apps/cli/src/server/csp.ts`'s
with `connect-src 'none'`: the page reaches nothing, the bridge is its only
way out. There is no dev server: the CSP refuses the inline script a Vite dev
page injects, and the page means nothing without a native end.

## The bridge

`src/bridge/protocol.ts` is the wire, exported as `./bridge-protocol` so the
native end parses the same frames. Both ends ship in one binary, so it breaks
freely: no version field. Every frame is the JSON text of one, parsed by the
end that receives it.

- Page to native: `ready` (the door is installed; it knows no nonce yet), then
  requests `{ id, nonce, kind, payload }` — `list`, `read`, `write` (under the
  `absent` or `expected` guard, the base TEXT the native end compares with its
  store), `remove`, `rename`, `readAsset`, `writeAsset` (bytes as base64),
  `wikiTargets`, `pickImage` — and events: `opened`, `editorState` (dirty and
  why a save failed, sent only when either changes), `mergeConflict`,
  `showComments`, `navigate`, `askAgent`, `showTag`, `flushed`.
- Native to page: `init { nonce, path, focus, theme }`, `response { id, ok }`,
  `vaultChanged`, `flush` (answered by `flushed` with its id), `theme`.

Native reaches the page ONLY by `injectJavaScript` of `nativeFrameScript(frame)`,
which calls the door `connectPageBridge` installs on `window`, non-writable and
non-configurable (`src/bridge/page-bridge.ts`): a message event is one a child
frame's `parent.postMessage` could forge. The first well-formed `init` sets the
nonce; a frame without it, or with another load's, is dropped, as is anything
malformed. A request times out after `REQUEST_TIMEOUT_MS`, except the photo
picker, which waits on the user; an answer is parsed by the kind it answers.

`src/host/page-host.ts` builds the editor's host over the bridge: the
`VaultSessionPorts`, the editor's own `createGuardedVaultIo` over a
`GuardedVaultPort` of frames, its link-resolver store and note formulas, and
the `EditorHostIo`. Opening a note (a wiki link, a created note) writes this one
and sends `navigate`, so the native stack pushes the next page and keeps the
back gesture. A vanished note asks through the page's own confirm dialog.

## Layout

```
index.html              the page, its CSP and a scale-1 viewport
vite.config.ts          one IIFE, fonts inlined, the classic-page check
vite/classic-page.ts    the entry rewrite and the build's refusal
src/
  main.tsx              connects the bridge, waits for init, mounts
  editor-page.tsx       the providers, the column under the touch profile,
                        the focus init asks for, the theme native sends
  bridge/protocol.ts    the wire (zod), exported as ./bridge-protocol
  bridge/page-bridge.ts correlation, timeouts, the nonce, the window door
  host/page-host.ts     the editor's host over the bridge
  styles/globals.css    @repo/ui's and @repo/editor's sheets, and the page's
                        own values for the dials (--editor-size at 16px or
                        more, or iOS zooms)
```

## Testing

```bash
pnpm --filter @repo/mobile-editor test
```

`src/__tests__/fake-phone.ts` is the native end as the page sees it: a
transport that records frames and answers from an in-memory vault that CASes
on the base text. The suites cover correlation, timeouts and every dropped
frame (`page-bridge.test.ts`), each host port as one frame kind and back
(`page-host.test.ts`), and a mounted page whose typed paragraph reaches the
phone as `serializeNote`'s bytes (`editor-page.test.tsx`, compiled like the
shipped page). `vite/__tests__/classic-page.test.ts` pins the build's verdicts.
The page in a real browser from `file://`, with a scripted phone on its
bridge, is `tools/e2e/src/scenarios/phone-editor-page.ts`.
