// the guarded dial against real sockets on 127.0.0.1: a suite injects the classification (so the
// loopback server reads as a public or a private site) and the resolver (so a name answers what the
// case needs), and every refusal is proved by the listener having seen nothing.

import { once } from "node:events";
import { createServer } from "node:http";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { randomBytes } from "node:crypto";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { classifyAddress } from "../address-guard";
import type { AddressClass, AddressPolicy } from "../address-guard";
import { createGuardedFetch } from "../guarded-fetch";
import type { FetchRequest, GuardedFetchDeps, HostLookup, LookupAddress } from "../guarded-fetch";

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

interface Seen {
  path: string;
  headers: IncomingHttpHeaders;
}

const MiB = 1024 * 1024;

// `address()` answers a pipe name, an AddressInfo or null; a bound TCP port wants only the second
const boundPortSchema = z.object({ port: z.number().int() });
const servers: { close: () => Promise<void> }[] = [];

const listen = async (handler: Handler) => {
  const seen: Seen[] = [];
  const server = createServer((request, response) => {
    seen.push({ headers: request.headers, path: request.url ?? "/" });
    handler(request, response);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = boundPortSchema.parse(server.address());
  const close = async () => {
    server.closeAllConnections();
    server.close();
    await once(server, "close");
  };
  servers.push({ close });
  return { port, seen, url: (p: string) => `http://127.0.0.1:${port}${p}` };
};

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await server.close();
  }
});

// loopback reads as `as`; every other address keeps the guard's own class
const loopbackIs =
  (as: AddressClass): AddressPolicy =>
  (address) =>
    address === "127.0.0.1" ? as : classifyAddress(address);

const bothLoopbacksPublic: AddressPolicy = (address) =>
  address === "127.0.0.1" || address === "::1" ? "public" : classifyAddress(address);

const answers =
  (table: Readonly<Record<string, readonly LookupAddress[]>>, calls: string[] = []): HostLookup =>
  async (hostname) => {
    calls.push(hostname);
    const found = table[hostname];
    if (found === undefined) {
      throw Object.assign(new Error(`no such host ${hostname}`), { code: "ENOTFOUND" });
    }
    return await Promise.resolve([...found]);
  };

const v4 = (address: string): LookupAddress => ({ address, family: 4 });
const v6 = (address: string): LookupAddress => ({ address, family: 6 });

const guard = (overrides: Partial<GuardedFetchDeps> = {}) =>
  createGuardedFetch({
    acceptLanguage: "en-GB,en;q=0.9",
    ownPort: () => null,
    userAgent: "test-agent inteligir/9.9.9",
    ...overrides,
  });

const page = (url: string, extra: Partial<FetchRequest> = {}): FetchRequest => ({
  accept: "text/html",
  maxBytes: 5 * MiB,
  overflow: "truncate",
  reach: null,
  url,
  ...extra,
});

const html =
  (body: string): Handler =>
  (_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=UTF-8" });
    response.end(body);
  };

describe("the guarded fetch", () => {
  it("reads a page the policy lets it reach, sending no cookie, credential or referrer", async () => {
    const site = await listen(html("<p>hello</p>"));
    const result = await guard({ policy: loopbackIs("public") }).fetch(page(site.url("/a?b=1#c")));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(new TextDecoder().decode(result.response.bytes)).toBe("<p>hello</p>");
    expect(result.response).toMatchObject({
      charset: "utf-8",
      mediaType: "text/html",
      reach: "public",
      status: 200,
      truncated: false,
    });
    const [request] = site.seen;
    expect(request?.path).toBe("/a?b=1");
    expect(request?.headers["user-agent"]).toBe("test-agent inteligir/9.9.9");
    expect(request?.headers["accept-language"]).toBe("en-GB,en;q=0.9");
    expect(request?.headers["accept-encoding"]).toBe("gzip, deflate, br");
    for (const header of ["cookie", "authorization", "referer", "proxy-authorization"]) {
      expect(request?.headers[header], header).toBeUndefined();
    }
  });

  it("refuses the same address under the default policy, before any request", async () => {
    const site = await listen(html("<p>hello</p>"));
    const result = await guard().fetch(page(site.url("/")));
    expect(result).toEqual({ failure: { kind: "refused", refusal: "this-mac" }, ok: false });
    expect(site.seen).toEqual([]);
  });

  it("refuses the server's own port on any address, and localhost before any lookup", async () => {
    const site = await listen(html("<p>hello</p>"));
    const calls: string[] = [];
    const fetcher = guard({
      lookup: answers({}, calls),
      ownPort: () => site.port,
      policy: loopbackIs("public"),
    });
    expect(await fetcher.fetch(page(site.url("/")))).toEqual({
      failure: { kind: "refused", refusal: "this-mac" },
      ok: false,
    });
    expect(await fetcher.fetch(page("http://app.localhost:9/"))).toEqual({
      failure: { kind: "refused", refusal: "this-mac" },
      ok: false,
    });
    expect(calls).toEqual([]);
    expect(site.seen).toEqual([]);
  });

  it("resolves a name once per hop and dials only that answer, so a rebind cannot slip in", async () => {
    const site = await listen(html("<p>hello</p>"));
    const calls: string[] = [];
    let turn = 0;
    const rebinding: HostLookup = async (hostname) => {
      calls.push(hostname);
      turn += 1;
      return await Promise.resolve(turn === 1 ? [v4("127.0.0.1")] : [v4("127.0.0.2")]);
    };
    const fetcher = guard({ lookup: rebinding, policy: loopbackIs("public") });
    const first = await fetcher.fetch(page(`http://rebind.test:${site.port}/`));
    expect(first.ok).toBe(true);
    expect(calls).toEqual(["rebind.test"]);
    const second = await fetcher.fetch(page(`http://rebind.test:${site.port}/`));
    expect(second).toEqual({ failure: { kind: "refused", refusal: "this-mac" }, ok: false });
    expect(site.seen).toHaveLength(1);
  });

  it("refuses a whole answer holding one address of this Mac, before any connect", async () => {
    const site = await listen(html("<p>hello</p>"));
    const dialed: LookupAddress[][] = [];
    const result = await guard({
      lookup: answers({ "dual.test": [v4("127.0.0.1"), v6("::1")] }),
      onDial: (addresses) => {
        dialed.push([...addresses]);
      },
      policy: loopbackIs("public"),
    }).fetch(page(`http://dual.test:${site.port}/`));
    expect(result).toEqual({ failure: { kind: "refused", refusal: "this-mac" }, ok: false });
    expect(dialed).toEqual([]);
    expect(site.seen).toEqual([]);
  });

  it("refuses a public name answering one of this Mac's own addresses, in any spelling", async () => {
    const site = await listen(html("<p>a service bound on every address</p>"));
    const dialed: LookupAddress[][] = [];
    const onDial = (addresses: readonly LookupAddress[]): void => {
      dialed.push([...addresses]);
    };
    // the loopback server stands in for a service on the Mac's own global address
    const own = guard({
      lookup: answers({
        "mapped.attacker.test": [v6("::ffff:8.8.4.4")],
        "x.attacker.test": [v4("127.0.0.1")],
      }),
      onDial,
      ownAddresses: () => ["127.0.0.1", "8.8.4.4"],
      policy: loopbackIs("public"),
    });
    expect(await own.fetch(page(`http://x.attacker.test:${site.port}/`))).toEqual({
      failure: { kind: "refused", refusal: "this-mac" },
      ok: false,
    });
    expect(await own.fetch(page("http://mapped.attacker.test/"))).toEqual({
      failure: { kind: "refused", refusal: "this-mac" },
      ok: false,
    });
    expect(dialed).toEqual([]);
    expect(site.seen).toEqual([]);
    // the same answer from a Mac that holds no such address is read
    const elsewhere = await guard({
      lookup: answers({ "x.attacker.test": [v4("127.0.0.1")] }),
      ownAddresses: () => ["192.168.1.20"],
      policy: loopbackIs("public"),
    }).fetch(page(`http://x.attacker.test:${site.port}/`));
    expect(elsewhere.ok).toBe(true);
  });

  it("refuses an answer mixing private and public addresses", async () => {
    const site = await listen(html("<p>hello</p>"));
    const result = await guard({
      lookup: answers({ "mixed.test": [v4("127.0.0.1"), v4("10.0.0.1")] }),
      policy: loopbackIs("public"),
    }).fetch(page(`http://mixed.test:${site.port}/`));
    expect(result).toEqual({ failure: { kind: "refused", refusal: "reserved" }, ok: false });
    expect(site.seen).toEqual([]);
  });

  it("hands the socket only the vetted answer while it tries each family", async () => {
    const site = await listen(html("<p>both</p>"));
    const dialed: LookupAddress[][] = [];
    const result = await guard({
      lookup: answers({ "both.test": [v6("::1"), v4("127.0.0.1")] }),
      onDial: (addresses) => {
        dialed.push([...addresses]);
      },
      policy: bothLoopbacksPublic,
    }).fetch(page(`http://both.test:${site.port}/`));
    expect(result.ok).toBe(true);
    expect(dialed.length).toBeGreaterThan(0);
    for (const answer of dialed) {
      for (const address of answer) {
        expect(["::1", "127.0.0.1"]).toContain(address.address);
      }
    }
  });

  it("refuses a redirect to the cloud metadata address, which it never dials", async () => {
    const site = await listen((_request, response) => {
      response.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
      response.end();
    });
    const dialed: LookupAddress[][] = [];
    const result = await guard({
      onDial: (addresses) => {
        dialed.push([...addresses]);
      },
      policy: loopbackIs("public"),
    }).fetch(page(site.url("/go")));
    expect(result).toEqual({ failure: { kind: "refused", refusal: "link-local" }, ok: false });
    expect(dialed).toEqual([]);
  });

  it("keeps a public page out of private space, by redirect or by subresource", async () => {
    const site = await listen((request, response) => {
      if (request.url === "/go") {
        response.writeHead(302, { location: "http://router.test/admin" });
        response.end();
        return;
      }
      html("<p>public</p>")(request, response);
    });
    const fetcher = guard({
      lookup: answers({ "router.test": [v4("192.168.1.1")] }),
      policy: loopbackIs("public"),
    });
    expect(await fetcher.fetch(page(site.url("/go")))).toEqual({
      failure: { kind: "refused", refusal: "private-from-public" },
      ok: false,
    });
    const first = await fetcher.fetch(page(site.url("/")));
    expect(first.ok && first.response.reach).toBe("public");
    const cover = await fetcher.fetch(
      page("http://router.test/cover.png", { accept: "image/*", reach: "public" }),
    );
    expect(cover).toEqual({
      failure: { kind: "refused", refusal: "private-from-public" },
      ok: false,
    });
  });

  it("lets a private page reach a private cover", async () => {
    const site = await listen((request, response) => {
      if (request.url === "/cover.png") {
        response.writeHead(200, { "content-type": "image/png" });
        response.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        return;
      }
      html("<p>lan</p>")(request, response);
    });
    const fetcher = guard({ policy: loopbackIs("private") });
    const first = await fetcher.fetch(page(site.url("/")));
    expect(first.ok && first.response.reach).toBe("private");
    const cover = await fetcher.fetch(
      page(site.url("/cover.png"), { accept: "image/*", reach: "private" }),
    );
    expect(cover.ok && cover.response.mediaType).toBe("image/png");
  });

  it("decides a captured page's reach from its host alone, with no request", async () => {
    const site = await listen(html("<p>never</p>"));
    const fetcher = guard({
      lookup: answers({ "lan.test": [v4("10.0.0.7")], "web.test": [v4("8.8.8.8")] }),
    });
    expect(await fetcher.reachOf("http://lan.test/x")).toEqual({ ok: true, reach: "private" });
    expect(await fetcher.reachOf("https://web.test/x")).toEqual({ ok: true, reach: "public" });
    expect(await fetcher.reachOf(site.url("/"))).toEqual({
      failure: { kind: "refused", refusal: "this-mac" },
      ok: false,
    });
    expect(site.seen).toEqual([]);
  });

  it("stops after five redirects", async () => {
    const site = await listen((request, response) => {
      response.writeHead(301, { location: `${request.url ?? "/"}x` });
      response.end();
    });
    const result = await guard({ policy: loopbackIs("public") }).fetch(page(site.url("/")));
    expect(result).toEqual({ failure: { kind: "redirects" }, ok: false });
    expect(site.seen).toHaveLength(6);
  });

  it("follows a redirect without the credential its location carries", async () => {
    const at = { port: 0 };
    const site = await listen((request, response) => {
      if (request.url === "/start") {
        response.writeHead(307, {
          location: `http://user:secret@127.0.0.1:${String(at.port)}/end`,
        });
        response.end();
        return;
      }
      html("<p>end</p>")(request, response);
    });
    at.port = site.port;
    const result = await guard({ policy: loopbackIs("public") }).fetch(page(site.url("/start")));
    expect(result.ok && result.response.url).toBe(`http://127.0.0.1:${site.port}/end`);
    expect(site.seen.map((seen) => seen.headers.authorization)).toEqual([undefined, undefined]);
  });

  it("counts the decoded size, so a gzip bomb stops at the cap", async () => {
    const bomb = gzipSync(Buffer.alloc(64 * MiB));
    const site = await listen((_request, response) => {
      response.writeHead(200, { "content-encoding": "gzip", "content-type": "text/html" });
      response.end(bomb);
    });
    const fetcher = guard({ policy: loopbackIs("public") });
    const cut = await fetcher.fetch(page(site.url("/"), { maxBytes: 5 * MiB }));
    expect(cut.ok && cut.response.truncated).toBe(true);
    expect(cut.ok && cut.response.bytes.byteLength).toBe(5 * MiB);
    const refused = await fetcher.fetch(
      page(site.url("/"), { maxBytes: 5 * MiB, overflow: "refuse" }),
    );
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.failure.kind).toBe("too-large");
  });

  // a compressed body that stops partway: the decoder must end with the response it reads
  const ENCODED = {
    br: brotliCompressSync,
    deflate: deflateSync,
    gzip: gzipSync,
  } as const;
  const partly =
    (encoding: keyof typeof ENCODED, then: "stall" | "reset"): Handler =>
    (_request, response) => {
      // random bytes do not compress, so the first kilobyte is a fraction of the stream
      const encoded = ENCODED[encoding](randomBytes(256 * 1024));
      response.writeHead(200, { "content-encoding": encoding, "content-type": "text/html" });
      response.write(encoded.subarray(0, 1024), () => {
        if (then === "reset") {
          response.socket?.destroy();
        }
      });
    };

  it.each(["gzip", "deflate", "br"] as const)(
    "times out a %s body that stalls partway, within the deadline",
    async (encoding) => {
      const site = await listen(partly(encoding, "stall"));
      const startedAt = Date.now();
      const result = await guard({ policy: loopbackIs("public"), requestTimeoutMs: 300 }).fetch(
        page(site.url("/")),
      );
      expect(result).toEqual({ failure: { kind: "timeout" }, ok: false });
      expect(Date.now() - startedAt).toBeLessThan(3000);
    },
  );

  it.each(["gzip", "deflate", "br"] as const)(
    "answers unreachable for a %s body whose connection resets partway",
    async (encoding) => {
      const site = await listen(partly(encoding, "reset"));
      const result = await guard({ policy: loopbackIs("public"), requestTimeoutMs: 5000 }).fetch(
        page(site.url("/")),
      );
      expect(result.ok).toBe(false);
      expect(!result.ok && result.failure.kind).toBe("unreachable");
    },
  );

  it("refuses a declared size over the cap before reading it", async () => {
    const site = await listen((_request, response) => {
      response.writeHead(200, { "content-length": String(24 * MiB), "content-type": "image/png" });
      response.end();
    });
    const result = await guard({ policy: loopbackIs("public") }).fetch(
      page(site.url("/big.png"), { maxBytes: 10 * MiB, overflow: "refuse" }),
    );
    expect(result).toEqual({ failure: { bytes: 24 * MiB, kind: "too-large" }, ok: false });
  });

  it("words a site's error status in node's own terms, retrying only 429 and 503", async () => {
    const site = await listen((request, response) => {
      response.writeHead(request.url === "/busy" ? 503 : 404, "Whatever The Site Says");
      response.end();
    });
    const fetcher = guard({ policy: loopbackIs("public") });
    expect(await fetcher.fetch(page(site.url("/gone")))).toEqual({
      failure: { kind: "status", reason: "not found", status: 404, transient: false },
      ok: false,
    });
    expect(await fetcher.fetch(page(site.url("/busy")))).toEqual({
      failure: { kind: "status", reason: "service unavailable", status: 503, transient: true },
      ok: false,
    });
  });

  it("times out a page that never answers", async () => {
    const site = await listen(() => {
      // never answers
    });
    const result = await guard({ policy: loopbackIs("public"), requestTimeoutMs: 300 }).fetch(
      page(site.url("/")),
    );
    expect(result).toEqual({ failure: { kind: "timeout" }, ok: false });
  });

  it("answers aborted when the caller's signal fires", async () => {
    const site = await listen(() => {
      // never answers
    });
    const controller = new AbortController();
    const pending = guard({ policy: loopbackIs("public") }).fetch(
      page(site.url("/"), { signal: controller.signal }),
    );
    setTimeout(() => {
      controller.abort();
    }, 50);
    expect(await pending).toEqual({ failure: { kind: "aborted" }, ok: false });
  });

  it("answers unreachable for a refused connection and a name that does not resolve", async () => {
    const site = await listen(html(""));
    const { port } = site;
    await servers.pop()?.close();
    const fetcher = guard({ lookup: answers({}), policy: loopbackIs("public") });
    expect(await fetcher.fetch(page(`http://127.0.0.1:${port}/`))).toEqual({
      failure: { kind: "unreachable", transient: false },
      ok: false,
    });
    expect(await fetcher.fetch(page("http://nowhere.test/"))).toEqual({
      failure: { kind: "unreachable", transient: false },
      ok: false,
    });
  });
});

// a throwaway self-signed certificate for 127.0.0.1 (P-256, valid until 2126), made for this test
// alone and trusted by nothing but the guard this test hands it to
const LOOPBACK_CERT = [
  "-----BEGIN CERTIFICATE-----",
  "MIIBkDCCATagAwIBAgIUOJ0FvDeP4wDNdqlAsr7NyXkgylUwCgYIKoZIzj0EAwIw",
  "FDESMBAGA1UEAwwJMTI3LjAuMC4xMCAXDTI2MTAxNzEwMzg1NFoYDzIxMjYwOTIz",
  "MTAzODU0WjAUMRIwEAYDVQQDDAkxMjcuMC4wLjEwWTATBgcqhkjOPQIBBggqhkjO",
  "PQMBBwNCAASEoOcD48am116brLp/oOII7/jhucDUGqamE9F3wSVFOMBq41GlKF0M",
  "7jdJMDfp4Bauy976tOSBYRdX5YYpjqYxo2QwYjAdBgNVHQ4EFgQUjn7XYKtjLr0g",
  "39KAp4xB/kquYLowHwYDVR0jBBgwFoAUjn7XYKtjLr0g39KAp4xB/kquYLowDwYD",
  "VR0TAQH/BAUwAwEB/zAPBgNVHREECDAGhwR/AAABMAoGCCqGSM49BAMCA0gAMEUC",
  "IQDIx+Fb8BWP2j11PfJteNHO111V+NTCo83F2zoHWVUkkgIgal+h0dbmAj7EL2n/",
  "xcst1/sRN0Miqsp3yQNLjCGWlEc=",
  "-----END CERTIFICATE-----",
].join("\n");
const LOOPBACK_KEY = [
  "-----BEGIN PRIVATE KEY-----",
  "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgITSB/CFgIvxyu/EF",
  "LYxH4oQ1dqj+tOsIIGJRZ251lFKhRANCAASEoOcD48am116brLp/oOII7/jhucDU",
  "GqamE9F3wSVFOMBq41GlKF0M7jdJMDfp4Bauy976tOSBYRdX5YYpjqYx",
  "-----END PRIVATE KEY-----",
].join("\n");

describe("the guarded fetch over TLS", () => {
  it("refuses a certificate no trusted root signed, and reads one it trusts", async () => {
    const server = createHttpsServer(
      { cert: LOOPBACK_CERT, key: LOOPBACK_KEY },
      html("<p>secure</p>"),
    );
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = boundPortSchema.parse(server.address());
    try {
      const url = `https://127.0.0.1:${port}/`;
      expect(await guard({ policy: loopbackIs("public") }).fetch(page(url))).toEqual({
        failure: { kind: "tls" },
        ok: false,
      });
      const trusted = await guard({ ca: [LOOPBACK_CERT], policy: loopbackIs("public") }).fetch(
        page(url),
      );
      expect(trusted.ok && new TextDecoder().decode(trusted.response.bytes)).toBe("<p>secure</p>");
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});
