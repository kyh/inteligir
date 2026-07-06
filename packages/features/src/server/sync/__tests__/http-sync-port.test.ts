import crypto from "node:crypto";
import { describe, expect, it } from "vitest";

import { HttpSyncPort, createHttpSyncPort, type FetchFn } from "../http-sync-port";
import {
  HEADER_BASE_VERSION,
  HEADER_CONTENT_HASH,
  HEADER_VERSION,
  formatBearer,
  formatChangeFrame,
} from "@repo/core/sync/wire";
import type { VaultManifest } from "@repo/core/sync/manifest";

const BASE_URL = "https://sync.example.test";
const VAULT_ID = "vault-1";
const TOKEN = "secret-token";

function sha256Hex(text: string): string {
  return crypto.createHash("sha256").update(new TextEncoder().encode(text)).digest("hex");
}

type Recorded = { url: string; method: string; headers: Headers; body: string | null };

/** A `fetch` fake that records each call and delegates to a per-test responder. */
function fakeFetch(respond: (call: Recorded) => Response | Promise<Response>): {
  fetchImpl: FetchFn;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  const fetchImpl: FetchFn = async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const bodyInit = init?.body;
    const body =
      typeof bodyInit === "string"
        ? bodyInit
        : bodyInit instanceof Uint8Array
          ? new TextDecoder().decode(bodyInit)
          : null;
    const call: Recorded = {
      url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body,
    };
    calls.push(call);
    return respond(call);
  };
  return { fetchImpl, calls };
}

function newPort(fetchImpl: FetchFn): HttpSyncPort {
  return createHttpSyncPort({ baseUrl: BASE_URL, vaultId: VAULT_ID, token: TOKEN, fetchImpl });
}

describe("HttpSyncPort", () => {
  it("GETs and parses the manifest, sending the bearer token", async () => {
    const manifest: VaultManifest = {
      vaultId: VAULT_ID,
      generation: 4,
      files: [{ path: "a.md", contentHash: sha256Hex("AAA"), version: 2, size: 3 }],
    };
    const { fetchImpl, calls } = fakeFetch(() => Response.json(manifest));

    const result = await newPort(fetchImpl).listManifest();

    expect(result).toEqual(manifest);
    expect(calls[0]?.url).toBe(`${BASE_URL}/v1/vault/${VAULT_ID}/manifest`);
    expect(calls[0]?.headers.get("authorization")).toBe(formatBearer(TOKEN));
  });

  it("throws on a non-OK manifest response", async () => {
    const { fetchImpl } = fakeFetch(() => new Response("boom", { status: 500 }));
    await expect(newPort(fetchImpl).listManifest()).rejects.toThrow(/HTTP 500/);
  });

  it("reads a file's bytes + version/content-hash headers", async () => {
    const body = "hello world";
    const { fetchImpl } = fakeFetch(
      () =>
        new Response(body, {
          status: 200,
          headers: { [HEADER_VERSION]: "7", [HEADER_CONTENT_HASH]: sha256Hex(body) },
        }),
    );

    const got = await newPort(fetchImpl).getFile("dir/x.md");

    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.file).toEqual({
        path: "dir/x.md",
        contentHash: sha256Hex(body),
        version: 7,
        size: body.length,
      });
      expect(new TextDecoder().decode(got.content)).toBe(body);
    }
  });

  it("maps a 404 to a typed not-found (not a throw)", async () => {
    const { fetchImpl } = fakeFetch(() => new Response(null, { status: 404 }));
    const got = await newPort(fetchImpl).getFile("missing.md");
    expect(got).toEqual({ ok: false, reason: "not-found" });
  });

  it("throws when a file response is missing its headers", async () => {
    const { fetchImpl } = fakeFetch(() => new Response("x", { status: 200 }));
    await expect(newPort(fetchImpl).getFile("x.md")).rejects.toThrow(/version or content-hash/);
  });

  it("PUTs bytes with the base-version header and parses an ok envelope", async () => {
    const file = { path: "a.md", contentHash: sha256Hex("AAA"), version: 3, size: 3 };
    const { fetchImpl, calls } = fakeFetch(() => Response.json({ ok: true, file }));

    const res = await newPort(fetchImpl).putFile("a.md", new TextEncoder().encode("AAA"), 2);

    expect(res).toEqual({ ok: true, file });
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.headers.get(HEADER_BASE_VERSION)).toBe("2");
    expect(calls[0]?.body).toBe("AAA");
  });

  it("returns a version-conflict from a PUT 200 body — never throws", async () => {
    const current = { path: "a.md", contentHash: sha256Hex("newer"), version: 9, size: 5 };
    const { fetchImpl } = fakeFetch(() =>
      Response.json({ ok: false, reason: "version-conflict", current }),
    );

    const res = await newPort(fetchImpl).putFile("a.md", new TextEncoder().encode("mine"), 4);

    expect(res).toEqual({ ok: false, reason: "version-conflict", current });
  });

  it("throws on a PUT auth failure (401)", async () => {
    const { fetchImpl } = fakeFetch(() => new Response(null, { status: 401 }));
    await expect(
      newPort(fetchImpl).putFile("a.md", new TextEncoder().encode("x"), 0),
    ).rejects.toThrow(/HTTP 401/);
  });

  it("DELETEs with the base-version header and parses the envelope", async () => {
    const { fetchImpl, calls } = fakeFetch(() => Response.json({ ok: true }));
    const res = await newPort(fetchImpl).deleteFile("a.md", 5);
    expect(res).toEqual({ ok: true });
    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.headers.get(HEADER_BASE_VERSION)).toBe("5");
  });

  it("decodes VaultChange frames off the SSE stream", async () => {
    const change = {
      kind: "upserted" as const,
      file: { path: "a.md", contentHash: sha256Hex("AAA"), version: 1, size: 3 },
    };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(formatChangeFrame(change)));
        controller.close();
      },
    });
    const { fetchImpl } = fakeFetch(
      () => new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );

    const received = await new Promise<unknown>((resolve) => {
      const unsubscribe = newPort(fetchImpl).subscribe((c) => {
        resolve(c);
        unsubscribe();
      });
    });

    expect(received).toEqual(change);
  });
});
