import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { InMemoryBaseStore } from "@repo/core/sync/base-store";
import { InMemoryBaseBlobStore } from "@repo/core/sync/blob-store";
import { SyncEngine, type SyncIo } from "@repo/core/sync/engine";
import { createHttpSyncPort } from "@repo/core/sync/http-sync-port";
import { isConflictCopyPath } from "@repo/core/sync/reconcile";
import { ABSENT_VERSION } from "@repo/core/sync/vault-file";
import {
  filePath,
  formatBearer,
  formatVersionHeader,
  HEADER_BASE_VERSION,
} from "@repo/core/sync/wire";

// ---------------------------------------------------------------------------
// END-TO-END sync test. Unlike sync.test.ts (which pokes the Worker's routes
// directly), this drives the REAL client stack — @repo/core's `SyncEngine` +
// `HttpSyncPort` — against the REAL Worker in one process: real Better Auth
// (D1), real VaultCoordinator (DO SQLite), real R2. The ONLY thing stubbed is
// the TCP hop: the port's `fetchImpl` is `SELF.fetch`, so requests route to the
// in-process Worker (running on workerd with nodejs_compat, exactly like prod).
//
// It proves the whole loop: sign in -> bearer -> reconcile push/pull ->
// coordinator manifest + R2 bytes -> a second device converges -> conflicts are
// preserved as copies -> another user is denied (403 -> error, no data leak).
// ---------------------------------------------------------------------------

const ORIGIN = "https://inteligir-cloud.workers.dev";

/** Route the client's fetch to the in-process Worker. */
const fetchSelf: typeof fetch = (input, init) => SELF.fetch(input, init);

/** Sign a user up + in via Better Auth; return the bearer token (set-auth-token). */
async function signIn(email: string): Promise<string> {
  const body = JSON.stringify({ email, password: "e2e-password-1234", name: email.split("@")[0] });
  const headers = { "content-type": "application/json", origin: ORIGIN };
  const up = await SELF.fetch(`${ORIGIN}/api/auth/sign-up/email`, {
    method: "POST",
    headers,
    body,
  });
  if (up.status !== 200) throw new Error(`sign-up ${up.status}: ${await up.text()}`);
  const inRes = await SELF.fetch(`${ORIGIN}/api/auth/sign-in/email`, {
    method: "POST",
    headers,
    body,
  });
  if (inRes.status !== 200) throw new Error(`sign-in ${inRes.status}: ${await inRes.text()}`);
  const token = inRes.headers.get("set-auth-token");
  if (token === null || token === "") throw new Error("no bearer token in set-auth-token header");
  return token;
}

/** sha-256 hex over Web Crypto (workerd) — the hasher the engine content-addresses with. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Filesystem-safe conflict-copy timestamp (the engine injects this; core is clock-free). */
function fsStamp(): string {
  return new Date().toISOString().replaceAll(":", "-").replace(".", "-");
}

/** A device's local vault — an in-memory SyncIo backed by a Map. */
function deviceVault(): { io: SyncIo; has: (p: string) => boolean; text: (p: string) => string } {
  const files = new Map<string, Uint8Array>();
  const io: SyncIo = {
    list: () => [...files.keys()].toSorted(),
    read: (path) => {
      const bytes = files.get(path);
      if (bytes === undefined) throw new Error(`read of absent file: ${path}`);
      return bytes;
    },
    write: (path, content) => {
      files.set(path, content);
    },
    remove: (path) => {
      files.delete(path);
    },
  };
  return {
    io,
    has: (p) => files.has(p),
    text: (p) => new TextDecoder().decode(files.get(p) ?? new Uint8Array()),
  };
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function engineFor(vaultId: string, token: string, io: SyncIo): SyncEngine {
  return new SyncEngine({
    vaultId,
    io,
    port: createHttpSyncPort({
      baseUrl: ORIGIN,
      vaultId,
      token,
      fetchImpl: fetchSelf,
      hasher: sha256Hex,
    }),
    base: new InMemoryBaseStore(),
    // Arm the merge ladder like both real clients do — the conflict test below
    // proves an overlapping edit STILL forks a copy with the ladder on.
    blobs: new InMemoryBaseBlobStore(),
    hash: sha256Hex,
    stamp: fsStamp,
  });
}

describe("end-to-end sync", () => {
  it("two devices converge through the real Worker", async () => {
    const token = await signIn("alice@example.com");
    const vaultId = "vault-e2e-converge";

    // Device A creates a note and pushes it.
    const a = deviceVault();
    a.io.write("notes/hello.md", bytes("# Hello\n"));
    const pushA = await engineFor(vaultId, token, a.io).syncOnce();
    expect(pushA.status).toBe("ok");
    expect(pushA).toMatchObject({ pushed: 1, pulled: 0, conflicts: 0 });

    // Device B (empty) pulls it — byte-for-byte.
    const b = deviceVault();
    const pullB = await engineFor(vaultId, token, b.io).syncOnce();
    expect(pullB.status).toBe("ok");
    expect(pullB).toMatchObject({ pushed: 0, pulled: 1 });
    expect(b.text("notes/hello.md")).toBe("# Hello\n");
  });

  it("both devices append to the same journal while apart → merged, ZERO conflict copies", async () => {
    const token = await signIn("frida@example.com");
    const vaultId = "vault-e2e-journal";
    const journal = "journal/2026-07-15.md";

    // Both devices converge on the morning entry (v1).
    const a = deviceVault();
    a.io.write(journal, bytes("# 2026-07-15\n\n- morning\n"));
    const engineA = engineFor(vaultId, token, a.io);
    await engineA.syncOnce();
    const b = deviceVault();
    const engineB = engineFor(vaultId, token, b.io);
    await engineB.syncOnce();

    // A appends + pushes (v2); B appends off the stale base, then syncs.
    a.io.write(journal, bytes("# 2026-07-15\n\n- morning\n- from A\n"));
    await engineA.syncOnce();
    b.io.write(journal, bytes("# 2026-07-15\n\n- morning\n- from B\n"));
    const outB = await engineB.syncOnce();

    // The ladder unions the tails (remote-committed-first) — no fork.
    expect(outB.status).toBe("ok");
    expect(outB).toMatchObject({ merged: 1, conflicts: 0, conflictPaths: [] });
    const both = "# 2026-07-15\n\n- morning\n- from A\n- from B\n";
    expect(b.text(journal)).toBe(both);

    // A pulls the merged entry as a plain one-sided remote change.
    const outA = await engineA.syncOnce();
    expect(outA).toMatchObject({ pulled: 1, conflicts: 0, merged: 0 });
    expect(a.text(journal)).toBe(both);

    // Zero conflict copies anywhere — the whole point of the ladder.
    expect(a.io.list().some(isConflictCopyPath)).toBe(false);
    expect(b.io.list().some(isConflictCopyPath)).toBe(false);
  });

  it("a concurrent edit is preserved as a conflict copy (nothing lost)", async () => {
    const token = await signIn("bob@example.com");
    const vaultId = "vault-e2e-conflict";

    // Both devices start converged on v1.
    const a = deviceVault();
    a.io.write("note.md", bytes("base\n"));
    const engineA = engineFor(vaultId, token, a.io);
    await engineA.syncOnce();
    const b = deviceVault();
    const engineB = engineFor(vaultId, token, b.io);
    await engineB.syncOnce();
    expect(b.text("note.md")).toBe("base\n");

    // A edits + pushes (remote advances to v2).
    a.io.write("note.md", bytes("edit-from-A\n"));
    await engineA.syncOnce();

    // B edits the SAME file off the stale base, then syncs -> conflict.
    b.io.write("note.md", bytes("edit-from-B\n"));
    const outB = await engineB.syncOnce();
    expect(outB.status).toBe("ok");
    expect(outB).toMatchObject({ conflicts: 1 });

    // The outcome NAMES the copy it created, end-to-end through the real
    // Worker — the path exists on B and core's reverse matcher recognizes it.
    if (outB.status !== "ok") throw new Error("expected an ok outcome");
    expect(outB.conflictPaths).toHaveLength(1);
    const namedCopy = outB.conflictPaths[0];
    expect(namedCopy).toBeDefined();
    if (namedCopy === undefined) throw new Error("unreachable");
    expect(isConflictCopyPath(namedCopy)).toBe(true);
    expect(b.io.list()).toContain(namedCopy);

    // Nothing lost: both edits survive on B (one at note.md, one in a copy).
    const all = b.io.list();
    const copy = all.find((p) => p.includes("conflict"));
    expect(copy).toBeDefined();
    const contents = new Set(all.map((p) => b.text(p)));
    expect(contents.has("edit-from-A\n")).toBe(true);
    expect(contents.has("edit-from-B\n")).toBe(true);
  });

  it("a different user cannot touch someone else's vault (403 -> error, no leak)", async () => {
    const owner = await signIn("carol@example.com");
    const vaultId = "vault-e2e-owned";
    const c = deviceVault();
    c.io.write("secret.md", bytes("carol only\n"));
    // Carol claims the vault (first writer).
    expect((await engineFor(vaultId, owner, c.io).syncOnce()).status).toBe("ok");

    // Mallory signs in and points a device at Carol's vault.
    const mallory = await signIn("mallory@example.com");
    const m = deviceVault();
    const outM = await engineFor(vaultId, mallory, m.io).syncOnce();

    // The engine never throws — the 403 comes back as an error outcome, and
    // Carol's file is NOT pulled onto Mallory's device.
    expect(outM.status).toBe("error");
    expect(m.has("secret.md")).toBe(false);
  });

  // The coordinator's PUT size cap (32 MiB — mirrors the literal in
  // vault-coordinator.ts) isn't reachable through SyncPort's typed ADTs (a 413
  // is a raw transport failure, not a PutResult variant), so these two hit the
  // coordinator's PUT route directly, the same way sync.test.ts does.
  describe("PUT size cap (413)", () => {
    const MAX_FILE_BYTES = 33_554_432; // 32 MiB — keep in sync with vault-coordinator.ts

    async function putRaw(vaultId: string, token: string, body: Uint8Array): Promise<Response> {
      return SELF.fetch(`${ORIGIN}${filePath(vaultId, "big.bin")}`, {
        method: "PUT",
        headers: {
          authorization: formatBearer(token),
          [HEADER_BASE_VERSION]: formatVersionHeader(ABSENT_VERSION),
        },
        body,
      });
    }

    it("a body over the cap is rejected with 413 and the manifest is untouched", async () => {
      const token = await signIn("dave@example.com");
      const vaultId = "vault-e2e-oversized";

      const res = await putRaw(vaultId, token, new Uint8Array(MAX_FILE_BYTES + 1));
      expect(res.status).toBe(413);

      const manifest = (await (
        await SELF.fetch(`${ORIGIN}/v1/vault/${vaultId}/manifest`, {
          headers: { authorization: formatBearer(token) },
        })
      ).json()) as { generation: number; files: unknown[] };
      expect(manifest.generation).toBe(0);
      expect(manifest.files).toEqual([]);
    });

    it("a body at exactly the cap is accepted", async () => {
      const token = await signIn("erin@example.com");
      const vaultId = "vault-e2e-at-cap";

      const res = await putRaw(vaultId, token, new Uint8Array(MAX_FILE_BYTES));
      expect(res.status).toBe(200);
      const put = (await res.json()) as { ok: boolean };
      expect(put.ok).toBe(true);
    }, 30_000);
  });
});
