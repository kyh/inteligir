// The node `BaseBlobStore` adapter: a flat directory of hash-named files.
// The engine-facing semantics (capture moments, GC, ladder fallback) are
// tested in @repo/core (engine-merge.test.ts); here we pin the node port's own
// contract: put/get round-trip, existence-checked no-op put, integrity-checked
// get, and a prune that touches only content-addressed entries.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createNodeBlobStore } from "../sync-manager";

const VAULT_ID = "vault-1";

function sha256Hex(text: string): string {
  return crypto.createHash("sha256").update(new TextEncoder().encode(text)).digest("hex");
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

let tmp: string;
let dir: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "blob-store-"));
  dir = path.join(tmp, "sync-blobs");
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("createNodeBlobStore", () => {
  it("round-trips put/get across store instances (persisted to disk)", () => {
    const hash = sha256Hex("hello\n");
    createNodeBlobStore(VAULT_ID, { dir }).put(hash, bytes("hello\n"));
    const got = createNodeBlobStore(VAULT_ID, { dir }).get(hash);
    expect(got).not.toBeNull();
    expect(new TextDecoder().decode(got ?? new Uint8Array())).toBe("hello\n");
  });

  it("returns null for a missing blob", () => {
    expect(createNodeBlobStore(VAULT_ID, { dir }).get(sha256Hex("nope"))).toBeNull();
  });

  it("put is an existence-checked no-op (the port contract) — never rewrites", () => {
    const store = createNodeBlobStore(VAULT_ID, { dir });
    const hash = sha256Hex("stable\n");
    store.put(hash, bytes("stable\n"));
    const before = fs.statSync(path.join(dir, hash)).mtimeMs;
    // A second put of the same hash must not touch the file — mobile calls put
    // for EVERY file on EVERY pass (no stat fingerprint there).
    store.put(hash, bytes("stable\n"));
    expect(fs.statSync(path.join(dir, hash)).mtimeMs).toBe(before);
  });

  it("get integrity-checks: a corrupted blob comes back null, never as base bytes", () => {
    const store = createNodeBlobStore(VAULT_ID, { dir });
    const hash = sha256Hex("original\n");
    store.put(hash, bytes("original\n"));
    fs.writeFileSync(path.join(dir, hash), bytes("tampered\n"));
    expect(store.get(hash)).toBeNull();
  });

  it("prune keeps the keep-set, drops the rest, and ignores foreign files", () => {
    const store = createNodeBlobStore(VAULT_ID, { dir });
    const keep = sha256Hex("keep\n");
    const drop = sha256Hex("drop\n");
    store.put(keep, bytes("keep\n"));
    store.put(drop, bytes("drop\n"));
    // A non-content-addressed foreign file must never be deleted.
    fs.writeFileSync(path.join(dir, "not-a-blob.txt"), "leave me");

    store.prune(new Set([keep]));

    expect(store.get(keep)).not.toBeNull();
    expect(store.get(drop)).toBeNull();
    expect(fs.existsSync(path.join(dir, "not-a-blob.txt"))).toBe(true);
  });

  it("prune on a store that never wrote anything is a no-op (no directory yet)", () => {
    expect(() => createNodeBlobStore(VAULT_ID, { dir }).prune(new Set())).not.toThrow();
  });
});
