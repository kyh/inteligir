import { describe, expect, it } from "vitest";

import { HttpSyncPort, createHttpSyncPort, type FetchFn } from "../http-sync-port";
import {
  HEADER_BASE_VERSION,
  HEADER_CONTENT_HASH,
  HEADER_VERSION,
  formatBearer,
  formatChangeFrame,
} from "../wire";
import type { VaultManifest } from "../manifest";

const BASE_URL = "https://sync.example.test";
const VAULT_ID = "vault-1";
const TOKEN = "secret-token";

// A deterministic, valid-shaped (64 lowercase hex) content hash. HttpSyncPort
// only checks `isValidHash` and round-trips the value verbatim, so a real sha256
// is unneeded here — keeping @repo/notes node-free even in tests.
function sha256Hex(text: string): string {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash.toString(16).padStart(8, "0").repeat(8);
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

// The fake hasher mirrors the test file's own `sha256Hex(text)` — it just
// decodes the bytes back to text first, so it agrees with whatever hash a
// well-formed response header carries in these tests.
const fakeHasher = async (bytes: Uint8Array): Promise<string> =>
  sha256Hex(new TextDecoder().decode(bytes));

function newPort(fetchImpl: FetchFn): HttpSyncPort {
  return createHttpSyncPort({
    baseUrl: BASE_URL,
    vaultId: VAULT_ID,
    token: TOKEN,
    fetchImpl,
    hasher: fakeHasher,
  });
}

describe("HttpSyncPort", () => {
  it("GETs and parses the manifest, sending the bearer token", async () => {
    const manifest: VaultManifest = {
      vaultId: VAULT_ID,
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

  describe("client-side hash verification", () => {
    it("succeeds when the body's hash matches the reported header", async () => {
      const body = "hello world";
      const { fetchImpl } = fakeFetch(
        () =>
          new Response(body, {
            status: 200,
            headers: { [HEADER_VERSION]: "7", [HEADER_CONTENT_HASH]: sha256Hex(body) },
          }),
      );

      const got = await newPort(fetchImpl).getFile("x.md");

      expect(got.ok).toBe(true);
    });

    it("throws when the body's hash doesn't match the reported header (a raced GET)", async () => {
      const body = "hello world";
      const { fetchImpl } = fakeFetch(
        () =>
          // The header claims a DIFFERENT file's hash than the body actually is —
          // simulating a PUT racing the DO's GET outside its mutation mutex.
          new Response(body, {
            status: 200,
            headers: { [HEADER_VERSION]: "7", [HEADER_CONTENT_HASH]: sha256Hex("some other body") },
          }),
      );

      await expect(newPort(fetchImpl).getFile("x.md")).rejects.toThrow(
        /don't match the reported content hash/,
      );
    });
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

  it("fires onEnd when the SSE stream closes on its own (drop/server close)", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
    const { fetchImpl } = fakeFetch(
      () => new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );

    await new Promise<void>((resolve) => {
      newPort(fetchImpl).subscribe(
        () => {},
        () => resolve(),
      );
    });
  });

  it("fires onEnd on a non-OK stream response, so supervisors can retry", async () => {
    const { fetchImpl } = fakeFetch(() => new Response(null, { status: 500 }));

    await new Promise<void>((resolve) => {
      newPort(fetchImpl).subscribe(
        () => {},
        () => resolve(),
      );
    });
  });

  it("does NOT fire onEnd after an explicit unsubscribe", async () => {
    // Hold the stream open until AFTER the unsubscribe, then close it — the
    // read loop then exits with the signal already aborted, and the suppression
    // branch must swallow the end instead of reporting a drop.
    const closers: (() => void)[] = [];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        closers.push(() => controller.close());
      },
    });
    const { fetchImpl } = fakeFetch(
      () => new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );

    let ended = false;
    const unsubscribe = newPort(fetchImpl).subscribe(
      () => {},
      () => {
        ended = true;
      },
    );
    // Let the fetch settle and the read loop start before aborting.
    await Promise.resolve();
    await Promise.resolve();
    unsubscribe();
    closers[0]?.();
    // Drain microtasks so a (buggy) onEnd would have fired by now.
    for (let i = 0; i < 10; i += 1) await Promise.resolve();

    expect(ended).toBe(false);
  });
});
