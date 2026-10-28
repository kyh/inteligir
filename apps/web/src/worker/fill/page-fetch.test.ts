// The cloud's guarded fetch, hop by hop: what it refuses to ask (every refusal before a byte
// leaves), each redirect judged again where it points, and the caps counted on the bytes as they
// arrive. The platform's fetch is stood in for, so every address a test names is asked of nobody.

import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchPage, pageFetch } from "./page-fetch";
import type { PageRequest } from "./page-fetch";
import { readPage } from "./read-page";
import { htmlPage, serveWeb } from "./test-support/fill-cell";

afterEach(() => {
  vi.restoreAllMocks();
});

const asking = (url: string, overrides: Partial<PageRequest> = {}): PageRequest => ({
  accept: "text/html",
  maxBytes: 1024,
  overflow: "truncate",
  url,
  ...overrides,
});

const redirect =
  (location: string, status = 302) =>
  () =>
    new Response(null, { headers: { location }, status });

describe("what the cloud never asks", () => {
  it.each([
    ["ftp://files.example/report.pdf"],
    ["file:///etc/passwd"],
    ["data:text/html,hello"],
    ["https://pages.example:8443/post"],
    ["http://pages.example:22/"],
    ["not an address"],
  ])("refuses %s, off the web or off its ports", async (url) => {
    const web = serveWeb({});
    expect(await fetchPage(asking(url))).toEqual({
      failure: { kind: "refused", refusal: "reserved" },
      ok: false,
    });
    expect(web.asked).toEqual([]);
  });

  it.each([
    ["http://localhost/"],
    ["http://127.0.0.1/"],
    ["http://10.1.2.3/"],
    ["http://172.16.0.9/"],
    ["http://192.168.1.1/"],
    ["http://169.254.169.254/latest/meta-data/"],
    ["http://[::1]/"],
    ["http://[fd00::1]/"],
    ["http://printer.local/"],
    ["http://metadata.google.internal/"],
    ["http://0.0.0.0/"],
    // the spellings a parser folds into a private address
    ["http://2130706433/"],
    ["http://0177.0.0.1/"],
    ["http://0x7f.0.0.1/"],
    ["http://0xa000001/"],
    ["http://[::ffff:192.168.0.1]/"],
  ])("refuses %s, a name for private space, as the saved address's own place", async (url) => {
    const web = serveWeb({});
    expect(await fetchPage(asking(url))).toEqual({
      failure: { kind: "refused", refusal: "private-network" },
      ok: false,
    });
    expect(web.asked).toEqual([]);
  });

  it.each([["http://192.0.2.10/post"], ["http://203.0.113.1/"], ["http://[2001:db8::1]/"]])(
    "refuses %s, an address no host holds, as no address a page is read from",
    async (url) => {
      const web = serveWeb({});
      expect(await fetchPage(asking(url))).toEqual({
        failure: { kind: "refused", refusal: "reserved" },
        ok: false,
      });
      expect(web.asked).toEqual([]);
    },
  );

  it("asks a public address written out as it would ask its name", async () => {
    const web = serveWeb({
      "http://93.184.216.34/post": htmlPage("<p>an address</p>"),
      "http://[2606:4700:4700::1111]/": htmlPage("<p>a v6 address</p>"),
    });
    expect(await fetchPage(asking("http://93.184.216.34/post"))).toMatchObject({ ok: true });
    expect(await fetchPage(asking("http://[2606:4700:4700::1111]/"))).toMatchObject({ ok: true });
    expect(web.asked.map((hop) => hop.url)).toEqual([
      "http://93.184.216.34/post",
      "http://[2606:4700:4700::1111]/",
    ]);
  });

  it("drops a credential the address carries, and sends no cookie of its own", async () => {
    const web = serveWeb({ "https://pages.example/post": htmlPage("<p>hi</p>") });
    const fetched = await fetchPage(asking("https://someone:secret@pages.example/post"));
    expect(fetched.ok).toBe(true);
    expect(web.asked.map((hop) => hop.url)).toEqual(["https://pages.example/post"]);
    const [hop] = web.asked;
    expect(hop?.headers.get("authorization")).toBeNull();
    expect(hop?.headers.get("cookie")).toBeNull();
    expect(web.spy.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  });
});

describe("a redirect", () => {
  it("is followed to a public page, relative or whole, each hop judged where it points", async () => {
    const web = serveWeb({
      "https://a.example/start": redirect("/next", 301),
      "https://a.example/next": redirect("https://b.example/end", 308),
      "https://b.example/end": htmlPage("<p>arrived</p>"),
    });
    const fetched = await fetchPage(asking("https://a.example/start"));
    expect(fetched).toMatchObject({ ok: true, page: { url: "https://b.example/end" } });
    expect(web.asked.map((hop) => hop.url)).toEqual([
      "https://a.example/start",
      "https://a.example/next",
      "https://b.example/end",
    ]);
  });

  it("to private space is refused as the public page's pointing there, and not asked", async () => {
    for (const location of [
      "http://127.0.0.1/",
      "http://10.0.0.5/",
      "http://router.lan/",
      "http://0x7f.1/",
      "http://[::ffff:a00:5]/",
    ]) {
      const web = serveWeb({ "https://a.example/start": redirect(location) });
      expect(await fetchPage(asking("https://a.example/start"))).toEqual({
        failure: { kind: "refused", refusal: "private-from-public" },
        ok: false,
      });
      expect(web.asked.map((hop) => hop.url)).toEqual(["https://a.example/start"]);
      vi.restoreAllMocks();
    }
  });

  it("off the web is refused too", async () => {
    serveWeb({ "https://a.example/start": redirect("ftp://a.example/file") });
    expect(await fetchPage(asking("https://a.example/start"))).toEqual({
      failure: { kind: "refused", refusal: "reserved" },
      ok: false,
    });
  });

  it("is followed five times at most", async () => {
    const routes = Object.fromEntries(
      Array.from({ length: 7 }, (_, hop) => [
        `https://loop.example/${String(hop)}`,
        redirect(`https://loop.example/${String(hop + 1)}`),
      ]),
    );
    const web = serveWeb(routes);
    expect(await fetchPage(asking("https://loop.example/0"))).toEqual({
      failure: { kind: "redirects" },
      ok: false,
    });
    expect(web.asked).toHaveLength(6);
  });
});

describe("the caps", () => {
  it("keep a page's head when it runs past its cap, and say it was cut", async () => {
    serveWeb({ "https://big.example/": () => new Response("x".repeat(5000)) });
    const fetched = await fetchPage(asking("https://big.example/", { maxBytes: 1000 }));
    expect(fetched).toMatchObject({ ok: true, page: { truncated: true } });
    expect(fetched.ok && fetched.page.bytes.length).toBe(1000);
  });

  it("refuse a cover past its cap, by the size declared or by the bytes counted", async () => {
    serveWeb({
      "https://big.example/counted": () =>
        new Response(
          new ReadableStream({
            start: (controller) => {
              controller.enqueue(new Uint8Array(700));
              controller.enqueue(new Uint8Array(700));
              controller.close();
            },
          }),
        ),
      "https://big.example/declared": () =>
        new Response("x".repeat(10), { headers: { "content-length": "999999" } }),
    });
    const refuse = { maxBytes: 1000, overflow: "refuse" } as const;
    expect(await fetchPage(asking("https://big.example/declared", refuse))).toEqual({
      failure: { bytes: 999_999, kind: "too-large" },
      ok: false,
    });
    expect(await fetchPage(asking("https://big.example/counted", refuse))).toEqual({
      failure: { bytes: 1400, kind: "too-large" },
      ok: false,
    });
  });

  it("read the type and charset a page declares", async () => {
    serveWeb({
      "https://pages.example/": () =>
        new Response("<p>hi</p>", {
          headers: { "content-type": 'Text/HTML; charset="ISO-8859-1"' },
        }),
    });
    expect(await fetchPage(asking("https://pages.example/"))).toMatchObject({
      ok: true,
      page: { charset: "ISO-8859-1", mediaType: "text/html", truncated: false },
    });
  });
});

describe("a page that did not answer", () => {
  it("says a status outside 2xx in the standard's words, a busy one as worth a later try", async () => {
    serveWeb({
      "https://busy.example/": htmlPage("", 429),
      "https://gone.example/": htmlPage("", 410),
    });
    expect(await fetchPage(asking("https://gone.example/"))).toEqual({
      failure: { kind: "status", reason: "gone", status: 410, transient: false },
      ok: false,
    });
    expect(await fetchPage(asking("https://busy.example/"))).toEqual({
      failure: { kind: "status", reason: "too many requests", status: 429, transient: true },
      ok: false,
    });
  });

  it("stops a read past its deadline, which the reading asks again later", async () => {
    // a site that answers only well past the deadline, by when the platform's fetch has given up
    // on the read's signal
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      await scheduler.wait(200);
      init?.signal?.throwIfAborted();
      return new Response("<p>too late</p>", { headers: { "content-type": "text/html" } });
    });
    const patient = pageFetch({ deadlineMs: 20 });
    expect(await patient(asking("https://slow.example/"))).toEqual({
      failure: { kind: "timeout" },
      ok: false,
    });
    const read = await readPage(
      { fetch: patient, keep: async () => await Promise.resolve(null) },
      { accountId: "a", coverHint: null, itemId: "i", url: "https://slow.example/" },
    );
    expect(read).toEqual({ kind: "retry", sentence: "The page took too long to answer." });
  });

  it("says a connection that failed as worth a later try", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Network connection lost."));
    expect(await fetchPage(asking("https://down.example/"))).toEqual({
      failure: { kind: "unreachable", transient: true },
      ok: false,
    });
  });
});
