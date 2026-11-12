# @repo/desktop — the Mac app

A window on the library tab the site serves at `/library`
([`apps/web/src/library`](../web/src/library/CLAUDE.md)), with a menu and the
stock updater. The shell is Tauri 2: Rust over the Mac's own WebKit. It bundles
no page, runs no node and no server, and keeps nothing of the library: the page
signs in, reads and writes as a browser tab does, so the app needs a
connection. Its decisions are this app's [`CLAUDE.md`](CLAUDE.md).

## Layout

```
src-tauri/      the shell, in Rust: the window and its origin pin, the menu, the updater
scripts/        the package step and the release notes, TypeScript node runs as it stands
```

## Seams

The page reaches the shell only for its update: three commands
(`check_for_updates`, `download_update`, `install_update`) and one
`update-state` event, which the window's one capability grants
(`src-tauri/capabilities/web-app.json`) and the page parses
(`apps/web/src/library/shell/desktop-bridge.ts`). `INTELIGIR_CLOUD_ORIGIN`, a
loopback origin only, points any build at another Worker on this machine
(`src-tauri/src/window.rs`).

## Testing and the dev loop

```bash
pnpm dev:web          # the local Worker, which the debug window opens
pnpm dev              # tauri dev: the shell compiled and launched on localhost:5174/library
```

An edit to the page reaches the window once `pnpm dev:web` rebuilt it and the
window reloads (⌘R); an edit to the Rust rebuilds and relaunches the shell. A
debug build's window has WebKit's inspector. `cargo test`, this workspace's
`pnpm test`, covers the origin pin, the local-site override and the update
states' wire; the packaged app is the owner's Mac smoke (`docs/releasing.md`
§ 5).

## Packaging

```bash
pnpm package:desktop      # → src-tauri/target/release/bundle/macos/Inteligir.app,
                          #   and the release's assets in .output/bin
```

`scripts/package.ts` writes the Rust crates' notices with `cargo about`, then
runs `tauri build` with a config of its own naming the notices, the signing and
the update feed. It signs with the Developer ID the keychain holds, notarizes
with `<repo>/.release/notary.env` (Tauri's own names: `APPLE_API_ISSUER`,
`APPLE_API_KEY`, `APPLE_API_KEY_PATH`), and signs the update with the updater
key in `.release/`; with no Developer ID, or `INTELIGIR_PACK_UNSIGNED=1`, the
pack is signed ad-hoc and opens only on the Mac that built it. The release
path is `docs/releasing.md`.
