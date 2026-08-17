// WHERE A PACKAGED INSTALL IS ROOTED, AND WHAT IT CONTAINS. One module,
// because this layout is not a detail of the build — it is a contract between
// six things that never import each other:
//
//   the build that STAGES it (build.mjs, right here)
//   the launcher entry that imports the staged app (src/main.ts)
//   the app's own entry resolver (apps/app/src/node/main.ts)
//   the agent's PATH resolver (apps/app/src/node/agent/agent-shell-env.ts)
//   the shell's server path (apps/desktop/src/main/server-paths.ts)
//   the two smokes that prove a real install
//
// FLATTENING IT FAILS SILENTLY. The app looks for its SPA beside the launcher
// and finds nothing; the agent's `inteligir` disappears from PATH with no
// error anywhere, and a model simply stops being able to drive the product.
// Nothing throws, nothing logs, and the only symptom is a capability that
// quietly stopped existing.
//
// Plain `.mjs` with JSDoc types on purpose: the two build scripts and the two
// smokes are run by `node` directly, with no compile step between them and
// this file. What CANNOT import it is the shipped TypeScript — apps/app must
// not depend on the package that packages it, and the shell would be bundling
// a build-time module into its main process. Those encoders are held against
// this module TEXTUALLY instead, by
// tools/repo-guards/src/install-layout.test.ts, which computes every string it
// looks for from the values below.

import { join, posix, resolve } from "node:path";

/** The published package. An install roots at `node_modules/<this>`. */
export const RUNTIME_PACKAGE = "inteligir";

/** The launcher's own build output directory, and its entry inside it. */
export const DIST_DIR = "dist";
export const LAUNCHER_ENTRY = "inteligir.mjs";

/** The staged tree mirrors the repo's own `apps/`, which is what lets the
 *  app's two runtime resolvers walk it with no packaged-install special case. */
export const APPS_DIR = "apps";
export const APP_DIR = "app";
export const CLI_DIR = "cli";

/** The app's Node bundle (with the forked watcher child and the migrations
 *  copied beside it) and the entry inside it. */
export const APP_BUNDLE_DIR = "dist-node";
export const APP_SERVER_ENTRY = "main.js";
/** The built SPA the prod fallback serves, staged beside the bundle. */
export const APP_CLIENT_DIR = "dist";

/** The CLI's shim: the file npm's `inteligir-cli` bin points at, and the one
 *  the server puts on the agent's PATH. Both want this exact name. */
export const CLI_BIN_DIR = "bin";
export const CLI_BIN_NAME = "inteligir";

/**
 * `<installRoot>/dist` — everything below is inside it.
 * @param {string} installRoot
 * @returns {string}
 */
export function distDir(installRoot) {
  return join(installRoot, DIST_DIR);
}

/**
 * The launcher's own entry: what `npx inteligir` runs.
 * @param {string} installRoot
 * @returns {string}
 */
export function launcherEntry(installRoot) {
  return join(distDir(installRoot), LAUNCHER_ENTRY);
}

/**
 * @param {string} installRoot
 * @returns {string}
 */
export function stagedAppDir(installRoot) {
  return join(distDir(installRoot), APPS_DIR, APP_DIR);
}

/**
 * @param {string} installRoot
 * @returns {string}
 */
export function stagedCliDir(installRoot) {
  return join(distDir(installRoot), APPS_DIR, CLI_DIR);
}

/**
 * The directory the app's server entry runs from.
 * @param {string} installRoot
 * @returns {string}
 */
export function appBundleDir(installRoot) {
  return join(stagedAppDir(installRoot), APP_BUNDLE_DIR);
}

/**
 * @param {string} installRoot
 * @returns {string}
 */
export function appServerEntry(installRoot) {
  return join(appBundleDir(installRoot), APP_SERVER_ENTRY);
}

/**
 * @param {string} installRoot
 * @returns {string}
 */
export function cliBinDir(installRoot) {
  return join(stagedCliDir(installRoot), CLI_BIN_DIR);
}

/**
 * @param {string} installRoot
 * @returns {string}
 */
export function cliBin(installRoot) {
  return join(cliBinDir(installRoot), CLI_BIN_NAME);
}

/**
 * The walk the AGENT's PATH resolver makes — up from the running bundle to the
 * CLI's bin, without ever knowing where the install is rooted. This is the one
 * that disappears silently, so it is expressed as the walk rather than as a
 * path built from a root nobody has at that point.
 * @param {string} bundleDir
 * @returns {string}
 */
export function cliBinDirFromAppBundle(bundleDir) {
  return resolve(bundleDir, "..", "..", CLI_DIR, CLI_BIN_DIR);
}

/**
 * An install inside a node_modules tree — an npm install, or the unpacked half
 * of a packaged .app.
 * @param {string} nodeModulesParent
 * @returns {string}
 */
export function installRootIn(nodeModulesParent) {
  return join(nodeModulesParent, "node_modules", RUNTIME_PACKAGE);
}

/**
 * The `bin` map the published manifest must declare, package-relative and
 * posix-spelled because npm reads it on every platform. `inteligir-cli` has to
 * be here rather than merely staged: npm strips the execute bit from every
 * packed file it does not name, and the agent's resolver refuses a file
 * without one.
 * @returns {Record<string, string>}
 */
export function publishedBinMap() {
  return {
    [RUNTIME_PACKAGE]: `./${posix.join(DIST_DIR, LAUNCHER_ENTRY)}`,
    [`${RUNTIME_PACKAGE}-cli`]: `./${posix.join(DIST_DIR, APPS_DIR, CLI_DIR, CLI_BIN_DIR, CLI_BIN_NAME)}`,
  };
}

/**
 * The staged app entry as the launcher's own bundle imports it: relative to
 * `dist/`, posix-spelled, because it is resolved as a URL.
 * @returns {string}
 */
export function appServerEntryFromDist() {
  return posix.join(APPS_DIR, APP_DIR, APP_BUNDLE_DIR, APP_SERVER_ENTRY);
}
