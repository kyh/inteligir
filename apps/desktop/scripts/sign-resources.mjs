// Every Mach-O the .app carries in Contents/Resources, signed before Tauri copies it there: the git
// a Mac without the developer tools runs, and the CLI's native addons and vendor binaries (better-
// sqlite3, the watcher, claude, codex and what they ship). Tauri signs the shell, the node beside it
// and the bundle, and its seal covers each resource's bytes, but notarization refuses any Mach-O
// inside that is not itself signed with the hardened runtime and a timestamp. Each takes the app's
// entitlements, as electron-builder's pass gave every binary it signed: node runs JIT, and the
// vendors' own runtimes do too.

import { spawnSync } from "node:child_process";
import { open, readdir } from "node:fs/promises";
import path from "node:path";

const packageRoot = path.resolve(import.meta.dirname, "..");
const ENTITLEMENTS = path.join(packageRoot, "resources", "entitlements.mac.plist");

// the magic numbers a Mach-O file, or a fat one, opens with
const MACH_O_MAGIC = new Set([
  0xfe_ed_fa_ce, 0xfe_ed_fa_cf, 0xce_fa_ed_fe, 0xcf_fa_ed_fe, 0xca_fe_ba_be, 0xbe_ba_fe_ca,
]);

const isMachO = async (file) => {
  const handle = await open(file, "r");
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(4), 0, 4, 0);
    return bytesRead === 4 && MACH_O_MAGIC.has(buffer.readUInt32BE(0));
  } finally {
    await handle.close();
  }
};

const machOsUnder = async (dir) => {
  const found = [];
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const file = path.join(entry.parentPath, entry.name);
      if (await isMachO(file)) {
        found.push(file);
      }
    }
  }
  return found;
};

// `-` signs ad-hoc: what an unsigned pack runs on, since Apple silicon runs nothing unsigned. An
// ad-hoc pack carries no team, so it takes no hardened runtime, whose library validation would
// refuse its own addons, and no timestamp, which only a Developer ID can get
export const signResources = async (dirs, identity, hardened) => {
  const options = hardened ? ["--options", "runtime", "--timestamp"] : [];
  let signed = 0;
  for (const dir of dirs) {
    for (const file of await machOsUnder(dir)) {
      const result = spawnSync(
        "codesign",
        ["--force", "--sign", identity, ...options, "--entitlements", ENTITLEMENTS, file],
        { encoding: "utf-8" },
      );
      if (result.status !== 0) {
        throw new Error(`codesign refused ${file}:\n${result.stderr}`);
      }
      signed += 1;
    }
  }
  return signed;
};
