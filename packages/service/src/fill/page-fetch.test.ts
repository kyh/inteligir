// The cloud's guarded read, hop by hop: what it refuses to ask (every refusal before a byte
// leaves), each redirect judged again where it points, and the caps counted on the bytes as they
// arrive. A suite's web answers its hops, so every address a test names is asked of nobody; what the
// dispatcher refuses after a lookup is `./public-dispatcher`'s suite's.

import { setTimeout } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import { htmlPage, redirect, serveWeb } from "../test-support/fill-web";
import { pageFetch } from "./page-fetch";
import type { HopFetch, PageRequest } from "./page-fetch";
import { PrivateAddressError } from "./public-dispatcher";
import { readPage } from "./read-page";

const readerOver = (fetch: HopFetch) => pageFetch({ deadlineMs: 20_000, fetch });

// a site that answers only well past the deadline, by when the read has given up on its signal
const slow: HopFetch = async (_url, init) => {
  await setTimeout(200);
  init.signal.throwIfAborted();
  return new Response("<p>too late</p>", { headers: { "content-type": "text/html" } });
};

const down: HopFetch = async () => {
  await Promise.resolve();
  throw new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED") });
};

// a web where one host resolves into private space, which undici rejects with the lookup's error as
// the cause of its own
const resolvingPrivately =
  (privateHost: string, routes: Parameters<typeof serveWeb>[0] = {}): HopFetch =>
  async (url, init) => {
    if (new URL(url).hostname === privateHost) {
      throw new TypeError("fetch failed", { cause: new PrivateAddressError(privateHost) });
    }
    return await serveWeb(routes).fetch(url, init);
  };

const asking = (url: string, overrides: Partial<PageRequest> = {}): PageRequest => ({
  accept: "text/html",
  maxBytes: 1024,
  overflow: "truncate",
  url,
  ...overrides,
});

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
    await expect(readerOver(web.fetch)(asking(url))).resolves.toStrictEqual({
      failure: { kind: "refused", refusal: "off-web" },
      ok: false,
    });
    expect(web.asked).toStrictEqual([]);
  });

  it.each([
    ["http://localhost/"],
    ["http://app.localhost/"],
    ["http://nas/"],
    ["http://printer.local/"],
    ["http://metadata.google.internal/"],
  ])("refuses %s, a name for private space, as the saved address's own place", async (url) => {
    const web = serveWeb({});
    await expect(readerOver(web.fetch)(asking(url))).resolves.toStrictEqual({
      failure: { kind: "refused", refusal: "private-network" },
      ok: false,
    });
    expect(web.asked).toStrictEqual([]);
  });

  it.each([
    ["http://93.184.216.34/post"],
    ["http://[2606:4700:4700::1111]/"],
    ["http://127.0.0.1/"],
    ["http://192.168.1.1/"],
    ["http://169.254.169.254/latest/meta-data/"],
    ["http://192.0.2.10/post"],
    ["http://[::1]/"],
    ["http://[fd00::1]/"],
    // the spellings a parser folds into a dotted quad or a bracketed address
    ["http://2130706433/"],
    ["http://0177.0.0.1/"],
    ["http://0x7f.0.0.1/"],
    ["http://0xa000001/"],
    ["http://127.1/"],
    ["http://127.0.0.1./"],
    ["http://[::ffff:192.168.0.1]/"],
  ])("refuses %s, an address written as numbers, wherever it points", async (url) => {
    const web = serveWeb({});
    await expect(readerOver(web.fetch)(asking(url))).resolves.toStrictEqual({
      failure: { kind: "refused", refusal: "address-literal" },
      ok: false,
    });
    expect(web.asked).toStrictEqual([]);
  });

  it("asks a name that only holds numbers as any other name", async () => {
    const web = serveWeb({ "https://172.16.example/": htmlPage("<p>a name</p>") });
    await expect(readerOver(web.fetch)(asking("https://172.16.example/"))).resolves.toMatchObject({
      ok: true,
    });
    expect(web.asked.map((hop) => hop.url)).toStrictEqual(["https://172.16.example/"]);
  });

  it("drops a credential the address carries, and sends no cookie of its own", async () => {
    const web = serveWeb({ "https://pages.example/post": htmlPage("<p>hi</p>") });
    const fetched = await readerOver(web.fetch)(
      asking("https://someone:secret@pages.example/post"),
    );
    expect(fetched.ok).toBe(true);
    expect(web.asked.map((hop) => hop.url)).toStrictEqual(["https://pages.example/post"]);
    const [hop] = web.asked;
    expect(hop?.headers.get("authorization")).toBeNull();
    expect(hop?.headers.get("cookie")).toBeNull();
    expect(hop?.redirect).toBe("manual");
  });
});

describe("a redirect", () => {
  it("is followed to a public page, relative or whole, each hop judged where it points", async () => {
    const web = serveWeb({
      "https://a.example/start": redirect("/next", 301),
      "https://a.example/next": redirect("https://b.example/end", 308),
      "https://b.example/end": htmlPage("<p>arrived</p>"),
    });
    const fetched = await readerOver(web.fetch)(asking("https://a.example/start"));
    expect(fetched).toMatchObject({ ok: true, page: { url: "https://b.example/end" } });
    expect(web.asked.map((hop) => hop.url)).toStrictEqual([
      "https://a.example/start",
      "https://a.example/next",
      "https://b.example/end",
    ]);
  });

  it.each([
    ["http://localhost/", "private-from-public"],
    ["http://router.lan/", "private-from-public"],
    ["http://nas/", "private-from-public"],
    ["http://127.0.0.1/", "address-literal"],
    ["http://10.0.0.5/", "address-literal"],
    ["http://0x7f.1/", "address-literal"],
    ["http://[::ffff:a00:5]/", "address-literal"],
    ["http://93.184.216.34/", "address-literal"],
  ])("to %s is refused as %s, and not asked", async (location, refusal) => {
    const web = serveWeb({ "https://a.example/start": redirect(location) });
    await expect(readerOver(web.fetch)(asking("https://a.example/start"))).resolves.toStrictEqual({
      failure: { kind: "refused", refusal },
      ok: false,
    });
    expect(web.asked.map((hop) => hop.url)).toStrictEqual(["https://a.example/start"]);
  });

  it("off the web is refused too", async () => {
    const web = serveWeb({ "https://a.example/start": redirect("ftp://a.example/file") });
    await expect(readerOver(web.fetch)(asking("https://a.example/start"))).resolves.toStrictEqual({
      failure: { kind: "refused", refusal: "off-web" },
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
    await expect(readerOver(web.fetch)(asking("https://loop.example/0"))).resolves.toStrictEqual({
      failure: { kind: "redirects" },
      ok: false,
    });
    expect(web.asked).toHaveLength(6);
  });
});

describe("the caps", () => {
  it("keep a page's head when it runs past its cap, and say it was cut", async () => {
    const web = serveWeb({ "https://big.example/": () => new Response("x".repeat(5000)) });
    const fetched = await readerOver(web.fetch)(asking("https://big.example/", { maxBytes: 1000 }));
    expect(fetched).toMatchObject({ ok: true, page: { truncated: true } });
    expect(fetched.ok && fetched.page.bytes.length).toBe(1000);
  });

  it("refuse a cover past its cap, by the size declared or by the bytes counted", async () => {
    const web = serveWeb({
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
    await expect(
      readerOver(web.fetch)(asking("https://big.example/declared", refuse)),
    ).resolves.toStrictEqual({
      failure: { bytes: 999_999, kind: "too-large" },
      ok: false,
    });
    await expect(
      readerOver(web.fetch)(asking("https://big.example/counted", refuse)),
    ).resolves.toStrictEqual({
      failure: { bytes: 1400, kind: "too-large" },
      ok: false,
    });
  });

  it("read the type and charset a page declares", async () => {
    const web = serveWeb({
      "https://pages.example/": () =>
        new Response("<p>hi</p>", {
          headers: { "content-type": 'Text/HTML; charset="ISO-8859-1"' },
        }),
    });
    await expect(readerOver(web.fetch)(asking("https://pages.example/"))).resolves.toMatchObject({
      ok: true,
      page: { charset: "ISO-8859-1", mediaType: "text/html", truncated: false },
    });
  });
});

describe("a page that did not answer", () => {
  it("says a status outside 2xx in the standard's words, a busy one as worth a later try", async () => {
    const web = serveWeb({
      "https://busy.example/": htmlPage("", 429),
      "https://gone.example/": htmlPage("", 410),
    });
    await expect(readerOver(web.fetch)(asking("https://gone.example/"))).resolves.toStrictEqual({
      failure: { kind: "status", reason: "gone", status: 410, transient: false },
      ok: false,
    });
    await expect(readerOver(web.fetch)(asking("https://busy.example/"))).resolves.toStrictEqual({
      failure: { kind: "status", reason: "too many requests", status: 429, transient: true },
      ok: false,
    });
  });

  it("stops a read past its deadline, which the reading asks again later", async () => {
    const patient = pageFetch({ deadlineMs: 20, fetch: slow });
    await expect(patient(asking("https://slow.example/"))).resolves.toStrictEqual({
      failure: { kind: "timeout" },
      ok: false,
    });
    const read = await readPage(
      { fetch: patient, keep: async () => await Promise.resolve(null) },
      { coverHint: null, itemId: "i", url: "https://slow.example/" },
    );
    expect(read).toStrictEqual({ kind: "retry", sentence: "The page took too long to answer." });
  });

  it("says a connection that failed as worth a later try", async () => {
    await expect(readerOver(down)(asking("https://down.example/"))).resolves.toStrictEqual({
      failure: { kind: "unreachable" },
      ok: false,
    });
  });
});

describe("a name that resolved into private space", () => {
  it("is said as the saved address's own place, with no try again", async () => {
    await expect(
      readerOver(resolvingPrivately("intranet.example"))(asking("https://intranet.example/")),
    ).resolves.toStrictEqual({
      failure: { kind: "refused", refusal: "private-network" },
      ok: false,
    });
  });

  it("is said as a public page pointing there when a redirect led to it", async () => {
    const fetch = resolvingPrivately("intranet.example", {
      "https://a.example/start": redirect("https://intranet.example/admin"),
    });
    await expect(readerOver(fetch)(asking("https://a.example/start"))).resolves.toStrictEqual({
      failure: { kind: "refused", refusal: "private-from-public" },
      ok: false,
    });
  });
});
