// Where the server the shell runs actually lives, and which executable runs
// it. Pure string work, so the two layouts that matter (a checkout and a
// packaged .app) are both pinned by tests instead of discovered on someone's
// machine.

import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";

/** The published package this shell wraps (apps/launcher). */
const RUNTIME_PACKAGE = "inteligir";

/**
 * The sibling `apps/app` checkout, which is what the server hashes as its cwd
 * for the per-checkout dev instance (data dir, vault dir, port). Structural,
 * and the same derivation apps/cli's discovery makes from its own package
 * root: the shell and the app ship in one checkout, one level apart.
 * realpath'd because the server hashes its (already real) cwd.
 *
 * A packaged app has no checkout — nothing under `apps/` exists inside the
 * asar — and derives nothing from this: production resolves `~/.inteligir`
 * and port 4664 without it. The unresolvable path is returned as-is rather
 * than guessed at.
 */
export function resolveAppCheckoutDir(appPath: string): string {
  const appDir = resolve(appPath, "..", "app");
  try {
    return realpathSync(appDir);
  } catch {
    return appDir;
  }
}

/**
 * The Node entry to spawn, derived from Electron's `app.getAppPath()`.
 *
 * ONE derivation serves both layouts, which is the point. In a checkout,
 * `node_modules/inteligir` is pnpm's link to `apps/launcher`, whose build
 * stages the app under `dist/apps/app`. In a packaged app the same relative
 * path lives inside the asar — and an asar is not a filesystem a child process
 * can be spawned from, so `asarUnpack` puts node_modules beside it and the
 * path is rewritten to the unpacked twin. The negative lookahead makes the
 * rewrite idempotent: an appPath that already names the unpacked tree is left
 * alone rather than turned into `app.asar.unpacked.unpacked`.
 */
export function resolveServerEntry(appPath: string): string {
  const unpacked = appPath.replace(/app\.asar(?!\.unpacked)/u, "app.asar.unpacked");
  return join(
    unpacked,
    "node_modules",
    RUNTIME_PACKAGE,
    "dist",
    "apps",
    "app",
    "dist-node",
    "main.js",
  );
}

export type ServerRuntimeMode = "electron-node" | "node";

export interface ServerRuntime {
  executablePath: string;
  mode: ServerRuntimeMode;
}

export interface ResolveServerRuntimeArgs {
  isPackaged: boolean;
  /** `process.execPath` — the Electron binary in both modes. */
  execPath: string;
}

/**
 * Which executable runs the server.
 *
 * A packaged app cannot assume a `node` on the user's PATH, so it runs its own
 * Electron binary with `ELECTRON_RUN_AS_NODE=1`. That is only affordable
 * because both native modules the server loads (better-sqlite3,
 * @parcel/watcher) are Node-API addons, whose binaries are ABI-stable across
 * Node and Electron; a gyp-built module would need a rebuild step here.
 * A checkout goes the other way and uses the developer's own `node`, which is
 * what the workspace's `node_modules` was installed for.
 */
export function resolveServerRuntime(args: ResolveServerRuntimeArgs): ServerRuntime {
  return args.isPackaged
    ? { executablePath: args.execPath, mode: "electron-node" }
    : { executablePath: "node", mode: "node" };
}

/**
 * The child's environment.
 *
 * `ELECTRON_RUN_AS_NODE` is set for the packaged runtime and REMOVED
 * otherwise — an inherited one would make a plain `node` child behave like
 * neither.
 *
 * `NODE_ENV` is always production, and that is a statement about the BUNDLE
 * rather than about the install: the child is always the built
 * `dist-node/main.js`, so a dev NODE_ENV would send it down the Vite
 * middleware path, into a `vite` import its bundle does not carry and a root
 * with no sources under it. Which data dir, vault and port that child uses is
 * NOT read from this flag — the shell resolves all three through the app's own
 * config module and passes them in `overrides`, so a checkout's shell drives
 * the per-checkout dev instance and never the developer's real vault.
 */
export function serverProcessEnv(
  env: NodeJS.ProcessEnv,
  mode: ServerRuntimeMode,
  overrides: Readonly<Record<string, string>>,
): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...env, ...overrides, NODE_ENV: "production" };
  if (mode === "electron-node") {
    next.ELECTRON_RUN_AS_NODE = "1";
  } else {
    delete next.ELECTRON_RUN_AS_NODE;
  }
  return next;
}
