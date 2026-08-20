// Provenance baseline for `src/components`: where each vendored file came from
// (shadcn registry item vs hand-written here) and the bytes we last accepted
// for it. Without it there is no record of what was copied, so a re-pull's
// damage — a clobbered local extension — is invisible until someone notices
// the behavior it carried is gone.
//
// The recorded hash is the LAST ACCEPTED bytes, not pristine upstream: these
// files were patched to the repo's rules (no `any`/`as`/`!`) before any record
// existed, and re-fetching every upstream revision to diff against would need
// the network and a per-file version pin nothing here has. So drift answers
// "what changed since we last accepted this file", which is the question a
// re-pull actually poses.
//
// Deliberately NOT a gate. Local edits to vendored files are sanctioned (see
// the README's invariants), so a check that failed on drift would fail on the
// intended state. Coverage is the invariant with teeth, and it lives in
// src/__tests__/components-provenance.test.ts.
//
//   node scripts/provenance.mjs           rewrite the manifest (regenerate)
//   node scripts/provenance.mjs --check   report drift, never fails

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMPONENTS_DIR = path.join(PACKAGE_ROOT, "src", "components");
const MANIFEST_PATH = path.join(PACKAGE_ROOT, "components.provenance.json");
const CONFIG_PATH = path.join(PACKAGE_ROOT, "components.json");

const REGISTRY_URL = "https://ui.shadcn.com";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function hashOf(name) {
  const bytes = fs.readFileSync(path.join(COMPONENTS_DIR, `${name}.tsx`));
  return createHash("sha256").update(bytes).digest("hex");
}

/** Component basenames, sorted — the manifest's key order is this order. */
function componentNames() {
  return fs
    .readdirSync(COMPONENTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
    .map((entry) => entry.name.replace(/\.tsx$/, ""))
    .toSorted();
}

function readManifest() {
  return fs.existsSync(MANIFEST_PATH) ? readJson(MANIFEST_PATH) : null;
}

// Origin and the upstream item name are HAND-CURATED — nothing on disk can
// tell a registry copy from a file written here — so a regenerate carries them
// forward untouched and only refreshes hashes. New files default to registry
// origin (the common case) and are announced, because a hand-written component
// silently recorded as vendored is the one wrong answer that never gets caught.
function build(previous) {
  const config = readJson(CONFIG_PATH);
  const components = {};
  const added = [];

  for (const name of componentNames()) {
    const before = previous?.components?.[name];
    if (!before) added.push(name);
    const sha256 = hashOf(name);
    components[name] =
      before?.origin === "local"
        ? { origin: "local", sha256 }
        : { origin: "registry", item: before?.item ?? name, sha256 };
  }

  const preset = previous?.registry?.preset;
  const registry = {
    url: REGISTRY_URL,
    // Mirrored from components.json, which is the config the shadcn CLI
    // actually reads; the test asserts they agree.
    style: config.style,
    baseColor: config.tailwind.baseColor,
  };
  // Not derivable from anything on disk: hand-written once, carried forward.
  if (preset !== undefined) registry.preset = preset;
  return {
    manifest: {
      generatedBy: "pnpm --filter @repo/ui provenance",
      registry,
      hash: "sha256",
      components,
    },
    added,
  };
}

function serialize(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function regenerate() {
  const { manifest, added } = build(readManifest());
  fs.writeFileSync(MANIFEST_PATH, serialize(manifest));
  console.log(
    `Wrote ${path.relative(PACKAGE_ROOT, MANIFEST_PATH)} (${
      Object.keys(manifest.components).length
    } components).`,
  );
  if (added.length > 0) {
    console.log(
      `New entries recorded as registry copies: ${added.join(", ")}.\n` +
        `If any was written here rather than pulled, set its "origin" to "local" by hand.`,
    );
  }
}

function report(label, items, hint) {
  if (items.length === 0) return;
  console.log(`\n${label}\n  ${items.join("\n  ")}\n${hint}`);
}

function check() {
  const manifest = readManifest();
  if (manifest === null) {
    console.error(
      `No ${path.relative(PACKAGE_ROOT, MANIFEST_PATH)} — run \`pnpm --filter @repo/ui provenance\`.`,
    );
    process.exitCode = 1;
    return;
  }

  const names = componentNames();
  const recorded = manifest.components;
  const drifted = names.filter((name) => recorded[name] && recorded[name].sha256 !== hashOf(name));
  const unrecorded = names.filter((name) => !recorded[name]);
  const stale = Object.keys(recorded).filter((name) => !names.includes(name));

  report(
    `Locally modified since the recorded baseline (${drifted.length}/${names.length}):`,
    drifted,
    "  These carry local edits. Re-apply them after a re-pull, then regenerate.",
  );
  report(
    "Not in the manifest:",
    unrecorded,
    "  Run `pnpm --filter @repo/ui provenance` and set the origin of anything hand-written.",
  );
  report(
    "In the manifest but no longer on disk:",
    stale,
    "  Run `pnpm --filter @repo/ui provenance` to drop them.",
  );

  if (drifted.length + unrecorded.length + stale.length === 0) {
    console.log(`All ${names.length} components match the recorded baseline.`);
  }
}

if (process.argv.includes("--check")) check();
else regenerate();
