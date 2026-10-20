import { afterEach, describe, expect, it, vi } from "vitest";
import { createPageFetch } from "./page-fetch";
import type { PageRequest, PlatformFetch } from "./page-fetch";

const HEADERS = { acceptLanguage: "en-US,en;q=0.9", userAgent: "inteligir-test" };

const PAGE: PageRequest = {
  accept: "text/html",
  maxBytes: 8,
  overflow: "truncate",
  url: "https://stephango.com/file-over-app",
};

const COVER: PageRequest = { ...PAGE, accept: "image/*", overflow: "refuse" };

afterEach(() => {
  vi.useRealTimers();
});

// a body that arrives in chunks, which says whether the reader let it go before its end
const chunked = (chunks: readonly string[]) => {
  let cancelled = false;
  let at = 0;
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    cancel: () => {
      cancelled = true;
    },
    pull: (controller) => {
      const next = chunks[at];
      at += 1;
      if (next === undefined) {
        controller.close();
      } else {
        controller.enqueue(encoder.encode(next));
      }
    },
  });
  return { body, cancelled: () => cancelled };
};

const answering =
  (response: () => Response, seen: { url: string; init: RequestInit }[] = []): PlatformFetch =>
  async (url, init) => {
    seen.push({ init, url });
    return await Promise.resolve(response());
  };

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

describe("the phone's page fetch", () => {
  it("asks as the phone's browser would, sending no cookie, and reads the page's type and charset", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchPage = createPageFetch(
      answering(
        () =>
          new Response("<h1>a</h1>", {
            headers: { "content-type": 'Text/HTML; charset="ISO-8859-1"' },
          }),
        seen,
      ),
      HEADERS,
    );

    const read = await fetchPage({ ...PAGE, maxBytes: 64 });

    expect(read).toStrictEqual({
      ok: true,
      page: {
        bytes: new TextEncoder().encode("<h1>a</h1>"),
        charset: "ISO-8859-1",
        declaredBytes: null,
        mediaType: "text/html",
        truncated: false,
        url: PAGE.url,
      },
    });
    expect(seen).toMatchObject([
      {
        init: {
          credentials: "omit",
          headers: {
            Accept: "text/html",
            "Accept-Language": "en-US,en;q=0.9",
            "User-Agent": "inteligir-test",
          },
          redirect: "follow",
        },
        url: PAGE.url,
      },
    ]);
  });

  it("asks nothing of an address that is not on the web", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchPage = createPageFetch(
      answering(() => new Response(""), seen),
      HEADERS,
    );

    expect(await fetchPage({ ...PAGE, url: "file:///etc/hosts" })).toStrictEqual({
      failure: { kind: "unreachable", transient: false },
      ok: false,
    });
    expect(seen).toStrictEqual([]);
  });

  it("says a refused status in the standard's words, a busy site as worth a later try", async () => {
    const gone = createPageFetch(
      answering(() => new Response("nope", { status: 404 })),
      HEADERS,
    );
    const busy = createPageFetch(
      answering(() => new Response("", { status: 503 })),
      HEADERS,
    );

    expect(await gone(PAGE)).toStrictEqual({
      failure: { kind: "status", reason: "not found", status: 404, transient: false },
      ok: false,
    });
    expect(await busy(PAGE)).toMatchObject({ failure: { status: 503, transient: true } });
  });

  it("keeps a page's first bytes up to the cap and reads no further", async () => {
    const stream = chunked(["<head>", "<body>", "never read"]);
    const fetchPage = createPageFetch(
      answering(() => new Response(stream.body)),
      HEADERS,
    );

    const read = await fetchPage(PAGE);

    expect(
      read.ok && { body: text(read.page.bytes), truncated: read.page.truncated },
    ).toStrictEqual({ body: "<head><b", truncated: true });
    expect(stream.cancelled()).toBe(true);
  });

  it("refuses a cover its site says is over the cap without reading it, and one that runs past it", async () => {
    const declared = chunked(["0123456789"]);
    const big = createPageFetch(
      answering(() => new Response(declared.body, { headers: { "content-length": "10" } })),
      HEADERS,
    );
    expect(await big(COVER)).toStrictEqual({
      failure: { bytes: 10, kind: "too-large" },
      ok: false,
    });
    expect(declared.cancelled()).toBe(true);

    const undeclared = chunked(["01234", "56789"]);
    const runs = createPageFetch(
      answering(() => new Response(undeclared.body)),
      HEADERS,
    );
    expect(await runs(COVER)).toStrictEqual({
      failure: { bytes: 10, kind: "too-large" },
      ok: false,
    });
  });

  it("says a page that never answered timed out, and one it could not reach unreachable for now", async () => {
    vi.useFakeTimers();
    const hanging = createPageFetch(
      async (_, init) =>
        // oxlint-disable-next-line promise/avoid-new -- a request that settles only when it is aborted
        await new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
      HEADERS,
    );
    const reading = hanging(PAGE);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await reading).toStrictEqual({ failure: { kind: "timeout" }, ok: false });

    const offline = createPageFetch(
      async () => await Promise.reject(new TypeError("Network request failed")),
      HEADERS,
    );
    expect(await offline(PAGE)).toStrictEqual({
      failure: { kind: "unreachable", transient: true },
      ok: false,
    });
  });
});
