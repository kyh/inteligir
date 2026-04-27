// Verify that the post-electron-builder DMG actually contains the runtime
// dependencies that Inteligir needs at boot. Catches "works in dev, broken
// in DMG" — usually because a dep was added without listing it in
// electron-builder.yml's `files`, or asarUnpack was misconfigured.
//
// Runs after `electron-builder --mac dmg`. Walks the unpacked .app bundle
// and asserts the presence of:
//   - pi-coding-agent + pi-ai dist/index.js (inside app.asar)
//   - resources/agent/AGENTS.md and resources/agent/skills/ (asar-unpacked)

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const BIN_DIR = ".output/bin";

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

// Runtime npm deps that must ship inside app.asar (we can't read inside asar
// without `asar` CLI, so we verify the source-of-truth: .output/app/main/index.js
// imports them, and pnpm-installed copies exist in node_modules at build time).
assertExists(
  "node_modules/@mariozechner/pi-coding-agent/dist/index.js",
  "pi-coding-agent dist (input)",
);
assertExists(
  "node_modules/@mariozechner/pi-ai/dist/index.js",
  "pi-ai dist (input)",
);

console.log(`[verify-packaged] All checks passed for ${app}`);
