import type { VaultManifest } from "@repo/core/sync/manifest";
import type { DeleteResult, PutResult, VaultChange } from "@repo/core/sync/sync-port";
import { ABSENT_VERSION } from "@repo/core/sync/vault-file";
import {
  changesPath,
  filePath,
  formatBearer,
  formatVersionHeader,
  HEADER_BASE_VERSION,
  HEADER_CONTENT_HASH,
  HEADER_VERSION,
  manifestPath,
} from "@repo/core/sync/wire";
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/hash";

// Real miniflare DO + R2 in-process (see vitest.config.ts). Every test uses a
// fresh vaultId -> a fresh DO instance, so state never bleeds across tests.
const ORIGIN = "http://coordinator";

/** Bearer auth for the stub: token === vaultId (see src/auth.ts). */
function auth(vaultId: string): Record<string, string> {
  return { authorization: formatBearer(vaultId) };
}

function getManifest(vaultId: string): Promise<Response> {
  return SELF.fetch(ORIGIN + manifestPath(vaultId), { headers: auth(vaultId) });
}

function putFile(vaultId: string, path: string, base: number, body: Uint8Array): Promise<Response> {
  return SELF.fetch(ORIGIN + filePath(vaultId, path), {
    method: "PUT",
    headers: { ...auth(vaultId), [HEADER_BASE_VERSION]: formatVersionHeader(base) },
    body,
  });
}

function getFile(vaultId: string, path: string): Promise<Response> {
  return SELF.fetch(ORIGIN + filePath(vaultId, path), { headers: auth(vaultId) });
}

function deleteFile(vaultId: string, path: string, base: number): Promise<Response> {
  return SELF.fetch(ORIGIN + filePath(vaultId, path), {
    method: "DELETE",
    headers: { ...auth(vaultId), [HEADER_BASE_VERSION]: formatVersionHeader(base) },
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
  it("manifest of an empty vault is empty at generation 0", async () => {
    const res = await getManifest("vault-empty");
    expect(res.status).toBe(200);
    const manifest = await readManifest(res);
    expect(manifest).toEqual({ vaultId: "vault-empty", generation: 0, files: [] });
  });

  it("rejects a request with no / wrong bearer token (401)", async () => {
    const noAuth = await SELF.fetch(ORIGIN + manifestPath("vault-auth"));
    expect(noAuth.status).toBe(401);
    const wrong = await SELF.fetch(ORIGIN + manifestPath("vault-auth"), {
      headers: { authorization: formatBearer("someone-else") },
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
    expect(manifest.generation).toBe(1);
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

    // Gone from the manifest (generation advanced), and GET is 404.
    const manifest = await readManifest(await getManifest(vaultId));
    expect(manifest.files).toEqual([]);
    expect(manifest.generation).toBe(2); // create + delete
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
    const streamRes = await SELF.fetch(ORIGIN + changesPath(vaultId), { headers: auth(vaultId) });
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
