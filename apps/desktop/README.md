# @repo/desktop — the Mac app

A window on the library tab the site serves at `/library`
([`apps/web/src/library`](../web/src/library/CLAUDE.md)), with a menu and
electron-updater. The shell is Electron: a main process and a sandboxed preload
around the site, bundled by electron-vite and packed by electron-builder. It
bundles no page and runs no server, and keeps nothing of the library: the page
signs in, reads and writes as a browser tab does, so the app needs a
connection. Its decisions are this app's [`CLAUDE.md`](CLAUDE.md).

## Layout

```
src/main/       the main process: the window and its origin pin, the menu, the updater
src/preload/    the sandboxed preload: window.desktopBridge, on the site's origin only
src/shared/     what the two share: the bridge's commands, events and update states
resources/      the icon, and the Assets.car compiled from the phone's app.icon
scripts/        the pack and the release notes, TypeScript node runs as it stands
```

## Seams

The page reaches the shell only for its update: three commands
(`check-for-updates`, `download-update`, `install-update`) and one
`update-state` event, over `window.desktopBridge`
(`src/shared/bridge.ts`), which the page parses
(`apps/web/src/library/shell/desktop-bridge.ts`).

## Testing and the dev loop

```bash
pnpm dev:web          # the local app, which the dev window opens
pnpm dev              # electron-vite dev: the shell built and launched on localhost:5174/library
```

An edit to the page reaches the window once `pnpm dev:web` rebuilt it and the
window reloads (⌘R); an edit to main or the preload rebuilds and relaunches the
shell. A dev window has Chromium's DevTools in its View menu. `pnpm test`
covers the origin pin, the download path and the update session; the packaged
app is the owner's Mac smoke (`docs/releasing.md` § 5).

## Packaging

```bash
pnpm package:desktop      # the release → .output/bin/mac-arm64/Inteligir.app, and its assets in .output/bin
```

A pack is `electron-vite build`, then `scripts/package.ts` with
`<repo>/.release/release.env`, taken as written (`dotenv --no-expand`, since a
value may hold a `$`). It runs electron-builder, which signs with the
hardened runtime and notarizes the app, then notarizes and staples the dmg,
and refuses to finish without the dmg, the zip, its blockmap and
`latest-mac.yml` as a release carries them. The npm packages' notices are
Vite's (`.output/app/main/notices/npm-packages.md`); Chromium's ship inside
Electron. The release path is `docs/releasing.md`.
