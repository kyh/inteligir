// ---------------------------------------------------------------------------
// The node binding of the JsonStore engine: ~/.inteligir path resolution, the
// realFs adapter (atomic tmp-then-rename writes, owner-only modes), and a
// JsonStore that defaults to it. The engine itself is platform-neutral and
// lives in json-store-core.ts.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { type TSchema } from "@sinclair/typebox";

import { atomicWrite } from "./atomic-write";
import { JsonStoreCore, type JsonStoreCoreOptions, type StoreAdapter } from "./json-store-core";

// INTELIGIR_HOME lets a linked worktree run its own app state beside the
// primary checkout's — every worktree otherwise shares this dir and the host
// lock refuses the second one. scripts/worktree-env.mjs sets it; unset (the
// normal case, and every packaged build) is the plain default.
const INTELIGIR_DIR = process.env["INTELIGIR_HOME"] ?? path.join(os.homedir(), ".inteligir");

export function inteligirPath(...segments: string[]): string {
  return path.join(INTELIGIR_DIR, ...segments);
}

/** Short stable file-name key for a path-like identifier (vault root,
 * vaultId — both may contain `/`): sha-256 hex, first 16 chars. The shared
 * idiom behind every per-vault file under ~/.inteligir (index DBs, sync base
 * manifests, sync blob dirs). */
export function shortPathKey(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);
}

/** Prefix of the per-vault last-synced blob dirs. Declared here rather than
 * beside the writer so the permission sweep and the writer cannot drift: the
 * dirs hold raw note bytes but carry a per-vault suffix, which puts them out
 * of reach of any exact-name list. */
export const SYNC_BLOBS_DIR_PREFIX = "sync-blobs-";

// ~/.inteligir holds credentials (pi's auth.json, secrets.json) — keep the
// directory itself owner-only. New dirs are created 0o700 by the mkdir calls
// below; this heals an existing dir that was created with looser permissions.
// Once per process: a wiped-and-recreated dir gets 0o700 from mkdir anyway.
let inteligirDirRestricted = false;
function restrictInteligirDir(filePath: string): void {
  if (inteligirDirRestricted || !filePath.startsWith(INTELIGIR_DIR + path.sep)) return;
  try {
    fs.chmodSync(INTELIGIR_DIR, 0o700);
    inteligirDirRestricted = true;
  } catch {
    // Dir may not exist yet (first write creates it 0o700) — best effort.
  }
}

// Writes go through the shared tmp-then-rename atomicWrite (storage/atomic-write).
//
// Mode is fixed owner-only (0o600): every JsonStore lives under
// ~/.inteligir, and several hold credentials or note content (secrets,
// the snapshots index, delegation records naming note lines). Revisit
// before ever pointing a JsonStore outside ~/.inteligir.
//
// Exported so other ~/.inteligir JSON writers (e.g. @repo/sync's base-manifest
// store) inherit the same atomic-write + owner-only guarantees instead of
// hand-rolling a weaker fs branch.
export const realFs: StoreAdapter = {
  read: (filePath) => {
    try {
      return fs.readFileSync(filePath, "utf8");
    } catch {
      return null;
    }
  },
  write: (filePath, content, mode) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    restrictInteligirDir(filePath);
    atomicWrite(filePath, content, { mode: mode ?? 0o600 });
  },
  rename: (from, to) => {
    fs.renameSync(from, to);
  },
};

export type JsonStoreOptions<T> = JsonStoreCoreOptions<T> & {
  /** Test seam — production stores take the default `realFs`. */
  fs?: StoreAdapter | undefined;
};

/** A JsonStore over a real file: the platform-neutral engine bound to the node
 * adapter, so a caller under ~/.inteligir inherits atomic writes and
 * owner-only modes without naming them. */
export class JsonStore<T> extends JsonStoreCore<T> {
  constructor(
    filePath: string,
    schema: TSchema,
    defaultValue: T,
    options: JsonStoreOptions<T> = {},
  ) {
    super(options.fs ?? realFs, filePath, schema, defaultValue, options);
  }
}
