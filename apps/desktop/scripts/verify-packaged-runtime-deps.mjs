// Verify that the post-electron-builder app actually contains the runtime
// dependencies that Inteligir needs at boot. Catches "works in dev, broken
// when packaged" — usually because a dep was added without listing it in
// electron-builder.yml's `files`, or asarUnpack was misconfigured.
//
// Runs after `electron-builder --mac`. Walks the unpacked .app bundle
// and asserts:
//   - agent resources (AGENTS.md, skills/) are copied to Contents/Resources/agent
//   - app.asar exists at all
//   - pi-coding-agent + pi-ai are bundled into the built main process. They
//     arrive transitively via the @repo/host workspace dep and are
//     tree-shaken INTO main/index.js by electron-vite — electron-builder.yml
//     excludes node_modules wholesale, so the failure mode is "didn't bundle,"
//     not "missing from package.json."

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve paths relative to the desktop app root (this script's parent
// directory) so the script behaves the same regardless of CWD.
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN_DIR = join(APP_ROOT, ".output/bin");
const MAIN_BUNDLE = join(APP_ROOT, ".output/app/main/index.js");
// pi ships bundled into the main process, not via node_modules. Verify the
// bundle actually contains it rather than guessing from package.json. (sherpa
// is the opposite — a native dep checked on-disk below, not bundled.)
const BUNDLED_RUNTIME_DEPS = ["@mariozechner/pi-coding-agent", "@mariozechner/pi-ai"];

// `electron-builder --mac` produces a .app inside .output/bin/mac{,-arm64}/
function findAppBundle() {
  if (!existsSync(BIN_DIR)) {
    fail(`No build output at ${BIN_DIR}. Run 'pnpm build' and 'electron-builder --mac' first.`);
  }
  for (const entry of readdirSync(BIN_DIR)) {
    if (!entry.startsWith("mac")) continue;
    const macDir = join(BIN_DIR, entry);
    if (!statSync(macDir).isDirectory()) continue;
    for (const inner of readdirSync(macDir)) {
      if (inner.endsWith(".app")) return join(macDir, inner);
    }
  }
  fail(`No .app bundle found inside ${BIN_DIR}. Did electron-builder finish?`);
  return ""; // unreachable
}

function fail(msg) {
  console.error(`[verify-packaged] ${msg}`);
  process.exit(1);
}

function assertExists(path, label) {
  if (!existsSync(path)) {
    fail(`Missing ${label}: ${path}`);
  }
  console.log(`[verify-packaged] OK: ${label}`);
}

// Find an unpacked sherpa-onnx-{platform} package containing the native
// sherpa-onnx.node addon. There's exactly one for the built target's
// platform/arch; we don't hardcode which so the check works on any host.
function assertPlatformBinaryUnpacked(unpackedNodeModules) {
  if (!existsSync(unpackedNodeModules)) {
    fail(`No unpacked node_modules at ${unpackedNodeModules}`);
  }
  const platformPkgs = readdirSync(unpackedNodeModules).filter(
    (name) => name.startsWith("sherpa-onnx-") && name !== "sherpa-onnx-node",
  );
  const withBinary = platformPkgs.find((name) =>
    existsSync(join(unpackedNodeModules, name, "sherpa-onnx.node")),
  );
  if (!withBinary) {
    fail(
      `No unpacked sherpa-onnx platform package with sherpa-onnx.node found. ` +
        `Saw: [${platformPkgs.join(", ") || "none"}]. Check asarUnpack globs in electron-builder.yml.`,
    );
  }
  console.log(`[verify-packaged] OK: native addon ${withBinary}/sherpa-onnx.node (unpacked)`);
}

const app = findAppBundle();
const resources = join(app, "Contents", "Resources");

// agent assets copied by extraResources
assertExists(join(resources, "agent", "AGENTS.md"), "AGENTS.md (unpacked)");
assertExists(join(resources, "agent", "skills"), "skills directory (unpacked)");

// asar exists at all
assertExists(join(resources, "app.asar"), "app.asar");

// sherpa-onnx-node must be asar-unpacked: .node binaries cannot be loaded
// from inside an asar archive. Without unpacking, voice STT crashes on
// first mic click in the packaged DMG.
const unpackedNodeModules = join(resources, "app.asar.unpacked", "node_modules");
assertExists(join(unpackedNodeModules, "sherpa-onnx-node"), "sherpa-onnx-node (unpacked)");

// The actual native addon lives in a per-platform package (e.g.
// sherpa-onnx-darwin-arm64), NOT in sherpa-onnx-node itself. sherpa-onnx-node
// require()s sibling/../sherpa-onnx-{platform}/sherpa-onnx.node at runtime, so
// that package — with its sherpa-onnx.node binary — must also be unpacked.
// This is the gap that silently breaks voice even when sherpa-onnx-node is present.
assertPlatformBinaryUnpacked(unpackedNodeModules);

// pi is tree-shaken into main/index.js (the pre-asar bundle electron-builder
// packs), so grep the built bundle for it. A miss means electron-vite dropped
// it — agent boot would crash in the DMG even though dev works.
if (!existsSync(MAIN_BUNDLE)) {
  fail(`No built main bundle at ${MAIN_BUNDLE}. Run 'electron-vite build' first.`);
}
const mainBundle = readFileSync(MAIN_BUNDLE, "utf8");
for (const dep of BUNDLED_RUNTIME_DEPS) {
  if (mainBundle.includes(dep)) {
    console.log(`[verify-packaged] OK: ${dep} bundled into main process`);
  } else {
    fail(`${dep} not found in the built main bundle — agent boot will crash in the DMG`);
  }
}

console.log(`[verify-packaged] All checks passed for ${app}`);
