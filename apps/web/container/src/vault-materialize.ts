// ---------------------------------------------------------------------------
// Putting the object's bytes under `./vault`, and the one path rule that
// governs where they may land.
//
// Split from the daemon because the DIRECTORY is a parameter here and a
// constant there: this is the half worth driving over a temporary directory in
// a test, and the traversal guard is the reason — a path that escapes the vault
// is refused rather than clamped.
// ---------------------------------------------------------------------------

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { base64ToBytes, type ContainerVaultPush } from "./protocol";
import type { VaultWatcher } from "./vault-watcher";

export type MaterializeOutcome = { ok: true } | { ok: false; error: string };

/**
 * Put a push's bytes under `dir`.
 *
 * Every write is announced to the watcher, which is what stops it coming back
 * as an agent edit (./vault-watcher). A path that would land outside the vault
 * is refused rather than clamped: the caller is the object, so such a path is a
 * bug worth surfacing, not input to sanitize.
 */
export async function materialize(
  dir: string,
  watcher: VaultWatcher,
  push: ContainerVaultPush,
): Promise<MaterializeOutcome> {
  if (push.replaceAll) {
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    // Everything under the directory is now the host's by construction, so
    // there is nothing left to attribute and nothing to report.
    watcher.reset();
  }

  for (const file of push.upserted) {
    const full = vaultPath(dir, file.path);
    if (full === null) return { ok: false, error: `${file.path} is not a path inside the vault` };
    const bytes = base64ToBytes(file.bytesBase64);
    if (bytes === null) return { ok: false, error: `${file.path} did not carry valid base64` };
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, bytes);
    await watcher.noteSelfChange(file.path);
  }

  for (const path of push.removed) {
    const full = vaultPath(dir, path);
    if (full === null) return { ok: false, error: `${path} is not a path inside the vault` };
    await rm(full, { force: true });
    await watcher.noteSelfChange(path);
  }
  return { ok: true };
}

/** The absolute path `relPath` names inside `dir`, or `null` when it names
 * something outside it — including `dir` itself. */
export function vaultPath(dir: string, relPath: string): string | null {
  const full = resolve(dir, relPath);
  const rel = relative(dir, full);
  return rel === "" || rel.startsWith("..") || isAbsolute(rel) ? null : full;
}
