// Verify that the post-electron-builder DMG actually contains the runtime
// dependencies that Inteligir needs at boot. Catches "works in dev, broken
// in DMG" — usually because a dep was added without listing it in
// electron-builder.yml's `files`, or asarUnpack was misconfigured.
//
// Runs after `electron-builder --mac dmg`. Walks the unpacked .app bundle
// and asserts:
//   - resources/agent/AGENTS.md and resources/agent/skills/ are asar-unpacked
//   - app.asar exists at all
//   - pi-coding-agent + pi-ai are listed under "dependencies" in
//     apps/desktop/package.json (not devDependencies). electron-builder
//     bundles only declared prod deps into the asar, so a misplacement is
//     the most likely way these would silently drop out of the DMG.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve paths relative to the desktop app root (this script's parent
// directory) so the script behaves the same regardless of CWD.
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN_DIR = join(APP_ROOT, ".output/bin");
const PACKAGE_JSON = join(APP_ROOT, "package.json");
const REQUIRED_RUNTIME_DEPS = [
  "@mariozechner/pi-coding-agent",
  "@mariozechner/pi-ai",
  // Native STT binding — .node files must also be asar-unpacked; see check below.
  "sherpa-onnx-node",
];

// `electron-builder --mac dmg` produces a .app inside .output/bin/mac{,-arm64}/
function findAppBundle() {
  if (!existsSync(BIN_DIR)) {
    fail(`No build output at ${BIN_DIR}. Run 'pnpm build' and 'electron-builder --mac dmg' first.`);
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

const app = findAppBundle();
const resources = join(app, "Contents", "Resources");

// asar-unpacked agent resources
assertExists(
  join(resources, "app.asar.unpacked", "resources", "agent", "AGENTS.md"),
  "AGENTS.md (unpacked)",
);
assertExists(
  join(resources, "app.asar.unpacked", "resources", "agent", "skills"),
  "skills directory (unpacked)",
);

// asar exists at all
assertExists(join(resources, "app.asar"), "app.asar");

// sherpa-onnx-node must be asar-unpacked: .node binaries cannot be loaded
// from inside an asar archive. Without unpacking, voice STT crashes on
// first mic click in the packaged DMG.
assertExists(
  join(resources, "app.asar.unpacked", "node_modules", "sherpa-onnx-node"),
  "sherpa-onnx-node (unpacked)",
);

// Reading inside app.asar without the `asar` CLI is awkward, so verify the
// source-of-truth that decides what ends up in the asar: every required
// runtime dep must be in `dependencies` (not `devDependencies`) of
// apps/desktop/package.json. electron-builder reads this file directly.
const pkg = JSON.parse(readFileSync(PACKAGE_JSON, "utf8"));
const declared = new Set(Object.keys(pkg.dependencies ?? {}));
const devOnly = new Set(Object.keys(pkg.devDependencies ?? {}));
for (const dep of REQUIRED_RUNTIME_DEPS) {
  if (declared.has(dep)) {
    console.log(`[verify-packaged] OK: ${dep} declared in dependencies`);
  } else if (devOnly.has(dep)) {
    fail(`${dep} is in devDependencies — won't be bundled into the DMG`);
  } else {
    fail(`${dep} is not declared in apps/desktop/package.json`);
  }
}

console.log(`[verify-packaged] All checks passed for ${app}`);
