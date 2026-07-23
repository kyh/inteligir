import type { VaultManifest } from "@repo/notes/sync/manifest";
import type { DeleteResult, PutResult, VaultChange } from "@repo/notes/sync/sync-port";
import { ABSENT_VERSION } from "@repo/notes/sync/vault-file";
import {
  changesPath,
  filePath,
  formatBearer,
  formatVersionHeader,
  HEADER_BASE_VERSION,
  HEADER_CONTENT_HASH,
  HEADER_VERSION,
  manifestPath,
} from "@repo/notes/sync/wire";
import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "../src/hash";

// Real miniflare DO + R2 + D1 in-process (see vitest.config.ts). Auth is real
// Better Auth over D1: tests sign a user up + in through `/api/auth/*`, pull the
// bearer token from the `set-auth-token` response header, and send it on the
// sync routes. Every request uses one ORIGIN, and the worker derives the auth
// baseURL from the request origin, so they line up automatically.
const ORIGIN = "https://inteligir-cloud.workers.dev";

/**
 * Sign a user up then in via the Better Auth handler; return the bearer token
 * (the bearer plugin surfaces it in the `set-auth-token` response header).
 */
async function signUpAndSignIn(email: string): Promise<string> {
  const password = "test-password-1234";
  const name = email.split("@")[0] ?? "user";
  const signUp = await SELF.fetch(ORIGIN + "/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ email, password, name }),
  });
  if (signUp.status !== 200) {
    throw new Error(`sign-up failed: ${signUp.status} ${await signUp.text()}`);
  }
  const signIn = await SELF.fetch(ORIGIN + "/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ email, password }),
  });
  if (signIn.status !== 200) {
    throw new Error(`sign-in failed: ${signIn.status} ${await signIn.text()}`);
  }
  const token = signIn.headers.get("set-auth-token");
  if (token === null || token === "") throw new Error("no set-auth-token header");
  return token;
}

// One shared owner for the sync-coordinator tests; each test uses a fresh
// vaultId, which this user claims on first touch.
let ownerToken = "";
beforeAll(async () => {
  ownerToken = await signUpAndSignIn("owner@example.com");
});

function auth(): Record<string, string> {
  return { authorization: formatBearer(ownerToken) };
}

function getManifest(vaultId: string): Promise<Response> {
  return SELF.fetch(ORIGIN + manifestPath(vaultId), { headers: auth() });
}

function putFile(vaultId: string, path: string, base: number, body: Uint8Array): Promise<Response> {
  return SELF.fetch(ORIGIN + filePath(vaultId, path), {
    method: "PUT",
    headers: { ...auth(), [HEADER_BASE_VERSION]: formatVersionHeader(base) },
    body,
  });
}

function getFile(vaultId: string, path: string): Promise<Response> {
  return SELF.fetch(ORIGIN + filePath(vaultId, path), { headers: auth() });
}

function deleteFile(vaultId: string, path: string, base: number): Promise<Response> {
  return SELF.fetch(ORIGIN + filePath(vaultId, path), {
    method: "DELETE",
    headers: { ...auth(), [HEADER_BASE_VERSION]: formatVersionHeader(base) },
  });
}

async function readManifest(res: Response): Promise<VaultManifest> {
  return (await res.json()) as VaultManifest;
}
async function readPut(res: Response): Promise<PutResult> {
  return (await res.json()) as PutResult;
}
async function readDelete(res: Response): Promise<DeleteResult> {
  return (await res.json()) as DeleteResult;
}

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("vault sync coordinator", () => {
  it("manifest of an untouched vault is empty", async () => {
    const res = await getManifest("vault-empty");
    expect(res.status).toBe(200);
    const manifest = await readManifest(res);
    expect(manifest).toEqual({ vaultId: "vault-empty", files: [] });
  });

  it("rejects a request with no / wrong bearer token (401)", async () => {
    const noAuth = await SELF.fetch(ORIGIN + manifestPath("vault-auth"));
    expect(noAuth.status).toBe(401);
    const wrong = await SELF.fetch(ORIGIN + manifestPath("vault-auth"), {
      headers: { authorization: formatBearer("not-a-real-token") },
    });
    expect(wrong.status).toBe(401);
  });

  it("PUT creates a file and the manifest reflects it", async () => {
    const vaultId = "vault-put";
    const content = bytes("# hello\n");
    const putRes = await putFile(vaultId, "notes/hello.md", ABSENT_VERSION, content);
    expect(putRes.status).toBe(200);

    const put = await readPut(putRes);
    expect(put.ok).toBe(true);
    if (!put.ok) throw new Error("expected ok");
    expect(put.file.version).toBe(1);
    expect(put.file.contentHash).toBe(await sha256Hex(content));
    expect(put.file.size).toBe(content.length);

    const manifest = await readManifest(await getManifest(vaultId));
    expect(manifest.files).toEqual([put.file]);
  });

  it("GET returns the bytes plus version + content-hash headers", async () => {
    const vaultId = "vault-get";
    const content = bytes("body bytes");
    await putFile(vaultId, "a.md", ABSENT_VERSION, content);

    const res = await getFile(vaultId, "a.md");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get(HEADER_VERSION)).toBe("1");
    expect(res.headers.get(HEADER_CONTENT_HASH)).toBe(await sha256Hex(content));
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(content);
  });

  it("GET of an absent file is 404", async () => {
    const res = await getFile("vault-404", "missing.md");
    expect(res.status).toBe(404);
  });

  it("a stale-base PUT returns version-conflict carrying the current file", async () => {
    const vaultId = "vault-conflict";
    await putFile(vaultId, "x.md", ABSENT_VERSION, bytes("v1"));

    // Re-create with the same absent base while the file is now at v1.
    const res = await putFile(vaultId, "x.md", ABSENT_VERSION, bytes("v2"));
    expect(res.status).toBe(200); // conflict is a value, not an HTTP error
    const put = await readPut(res);
    expect(put.ok).toBe(false);
    if (put.ok) throw new Error("expected conflict");
    expect(put.reason).toBe("version-conflict");
    expect(put.current.version).toBe(1);
    expect(put.current.contentHash).toBe(await sha256Hex(bytes("v1")));

    // The losing write did not change anything.
    const manifest = await readManifest(await getManifest(vaultId));
    expect(manifest.files.map((f) => f.version)).toEqual([1]);
  });

  it("DELETE removes the file (and 404s / conflicts appropriately)", async () => {
    const vaultId = "vault-delete";
    await putFile(vaultId, "d.md", ABSENT_VERSION, bytes("gone soon"));

    // Wrong base -> version-conflict.
    const stale = await readDelete(await deleteFile(vaultId, "d.md", 99));
    expect(stale.ok).toBe(false);
    if (stale.ok) throw new Error("expected conflict");
    expect(stale.reason).toBe("version-conflict");

    // Correct base -> ok.
    const ok = await readDelete(await deleteFile(vaultId, "d.md", 1));
    expect(ok.ok).toBe(true);

    // Gone from the manifest, and GET is 404.
    const manifest = await readManifest(await getManifest(vaultId));
    expect(manifest.files).toEqual([]);
    expect((await getFile(vaultId, "d.md")).status).toBe(404);

    // Deleting an absent file -> not-found.
    const missing = await readDelete(await deleteFile(vaultId, "d.md", ABSENT_VERSION));
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error("expected not-found");
    expect(missing.reason).toBe("not-found");
  });

  it("two racing creates: exactly one wins version 1, the other conflicts", async () => {
    const vaultId = "vault-race";
    const [resA, resB] = await Promise.all([
      putFile(vaultId, "race.md", ABSENT_VERSION, bytes("A")),
      putFile(vaultId, "race.md", ABSENT_VERSION, bytes("B")),
    ]);
    const [a, b] = await Promise.all([readPut(resA), readPut(resB)]);

    const winners = [a, b].filter((r) => r.ok);
    const losers = [a, b].filter((r) => !r.ok);
    expect(winners.length).toBe(1);
    expect(losers.length).toBe(1);

    const winner = winners[0];
    if (winner === undefined || !winner.ok) throw new Error("expected one winner");
    expect(winner.file.version).toBe(1);

    const loser = losers[0];
    if (loser === undefined || loser.ok) throw new Error("expected one loser");
    expect(loser.reason).toBe("version-conflict");
    expect(loser.current.version).toBe(1);

    // The vault holds exactly one file at version 1 (no double-win).
    const manifest = await readManifest(await getManifest(vaultId));
    expect(manifest.files.length).toBe(1);
    expect(manifest.files.map((f) => f.version)).toEqual([1]);
  });

  it("broadcasts an upsert to a subscribed changes (SSE) stream", async () => {
    const vaultId = "vault-sse";
    const streamRes = await SELF.fetch(ORIGIN + changesPath(vaultId), { headers: auth() });
    expect(streamRes.status).toBe(200);
    expect(streamRes.headers.get("content-type")).toContain("text/event-stream");

    const body = streamRes.body;
    if (body === null) throw new Error("no SSE body");
    const reader = body.getReader();
    try {
      // Wait for the ": connected" comment -> the subscription is registered.
      await readUntil(reader, ": connected", 5000);

      const content = bytes("streamed");
      await putFile(vaultId, "s.md", ABSENT_VERSION, content);

      const frame = await readUntil(reader, "event: change", 5000);
      const change = parseChangeFrame(frame);
      expect(change.kind).toBe("upserted");
      if (change.kind !== "upserted") throw new Error("expected upserted");
      expect(change.file.path).toBe("s.md");
      expect(change.file.version).toBe(1);
      expect(change.file.contentHash).toBe(await sha256Hex(content));
    } finally {
      await reader.cancel();
    }
  });
});

describe("vault auth (Better Auth + ownership)", () => {
  it("sign-up + sign-in issues a bearer token that authenticates a sync request", async () => {
    const token = await signUpAndSignIn("flow@example.com");
    expect(token.length).toBeGreaterThan(0);
    const res = await SELF.fetch(ORIGIN + manifestPath("vault-flow"), {
      headers: { authorization: formatBearer(token) },
    });
    expect(res.status).toBe(200);
  });

  it("first access to an unclaimed vault claims it, and the owner keeps access", async () => {
    const token = await signUpAndSignIn("claimer@example.com");
    const first = await SELF.fetch(ORIGIN + manifestPath("vault-claim"), {
      headers: { authorization: formatBearer(token) },
    });
    expect(first.status).toBe(200);
    const second = await SELF.fetch(ORIGIN + manifestPath("vault-claim"), {
      headers: { authorization: formatBearer(token) },
    });
    expect(second.status).toBe(200);
  });

  it("a second user cannot access a vault claimed by the first (403)", async () => {
    const alice = await signUpAndSignIn("alice@example.com");
    const bob = await signUpAndSignIn("bob@example.com");

    const claim = await SELF.fetch(ORIGIN + manifestPath("vault-shared"), {
      headers: { authorization: formatBearer(alice) },
    });
    expect(claim.status).toBe(200);

    const denied = await SELF.fetch(ORIGIN + manifestPath("vault-shared"), {
      headers: { authorization: formatBearer(bob) },
    });
    expect(denied.status).toBe(403);
  });
});

// ---- SSE reading helpers --------------------------------------------------

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  marker: string,
  timeoutMs: number,
): Promise<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`SSE timeout waiting for "${marker}"`)), timeoutMs),
    );
    const chunk = await Promise.race([reader.read(), timeout]);
    if (chunk.done) break;
    if (chunk.value !== undefined) buffer += decoder.decode(chunk.value, { stream: true });
    if (buffer.includes(marker)) return buffer;
  }
  throw new Error(`SSE stream ended before "${marker}"; got: ${buffer}`);
}

function parseChangeFrame(buffer: string): VaultChange {
  for (const line of buffer.split("\n")) {
    if (line.startsWith("data: ")) {
      return JSON.parse(line.slice("data: ".length)) as VaultChange;
    }
  }
  throw new Error(`no data line in SSE frame: ${buffer}`);
}
