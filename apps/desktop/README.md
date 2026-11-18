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
scripts/        a pack's release assets and the release notes, TypeScript node runs as it stands
```

## Seams

The page reaches the shell only for its update: three commands
(`check_for_updates`, `download_update`, `install_update`) and one
`update-state` event, which the window's one capability grants
(`src-tauri/capabilities/web-app.json`) and the page parses
(`apps/web/src/library/shell/desktop-bridge.ts`).

## Testing and the dev loop

```bash
pnpm dev:web          # the local app, which the debug window opens
pnpm dev              # tauri dev: the shell compiled and launched on localhost:5174/library
```

An edit to the page reaches the window once `pnpm dev:web` rebuilt it and the
window reloads (⌘R); an edit to the Rust rebuilds and relaunches the shell. A
debug build's window has WebKit's inspector. `cargo test`, this workspace's
`pnpm test`, covers the origin pin and the update states' wire; the packaged
app is the owner's Mac smoke (`docs/releasing.md` § 5).

## Packaging

```bash
pnpm package:desktop      # the release → src-tauri/target/release/bundle/macos/Inteligir.app,
                          #   and its assets in .output/bin
pnpm --filter @repo/desktop tauri build   # an unsigned .app for this Mac: no notices, no updates
```

A pack is `tauri build` on `src-tauri/tauri.package.conf.json`, which holds
what only a release has: the Rust crates' notices, written by `cargo about` as
its `beforeBuildCommand`, the dmg, the oldest macOS, and the update feed with
the public key the owner commits (`docs/releasing.md` § Once per product: the
update key). It signs with `<repo>/.release/release.env`, in Tauri's own names
and taken as written (`dotenv --no-expand`, since a password may hold a `$`).
`scripts/release-assets.ts` then refuses an app with no notarization ticket
and names the dmg, the signed update and `latest.json` as a release carries
them. The release path is `docs/releasing.md`.
