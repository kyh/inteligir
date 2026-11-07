import { afterEach, describe, expect, it, vi } from "vitest";
import { createPageFetch } from "./page-fetch";
import type { PhonePageRequest, PlatformFetch } from "./page-fetch";

const HEADERS = { acceptLanguage: "en-US,en;q=0.9", userAgent: "inteligir-test" };

const PAGE: PhonePageRequest = {
  accept: "text/html",
  from: "https://stephango.com/file-over-app",
  maxBytes: 8,
  overflow: "truncate",
  url: "https://stephango.com/file-over-app",
};

const COVER: PhonePageRequest = { ...PAGE, accept: "image/*", overflow: "refuse" };

// whatever stopped it: every refusal saves the link for the cloud to read
const NOT_READ = { ok: false };

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

    expect(read).toMatchObject({
      ok: true,
      page: {
        bytes: new TextEncoder().encode("<h1>a</h1>"),
        charset: "ISO-8859-1",
        mediaType: "text/html",
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
          redirect: "manual",
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

    await expect(fetchPage({ ...PAGE, url: "file:///etc/hosts" })).resolves.toMatchObject(NOT_READ);
    expect(seen).toStrictEqual([]);
  });

  it("reads no page from an answer that is not one, a redirect to nowhere included", async () => {
    for (const status of [304, 301, 404, 503]) {
      const fetchPage = createPageFetch(
        answering(() => new Response(status === 404 ? "nope" : null, { status })),
        HEADERS,
      );

      await expect(fetchPage(PAGE), String(status)).resolves.toMatchObject(NOT_READ);
    }
  });

  it("keeps a page's first bytes up to the cap and reads no further", async () => {
    const stream = chunked(["<head>", "<body>", "never read"]);
    const fetchPage = createPageFetch(
      answering(() => new Response(stream.body)),
      HEADERS,
    );

    const read = await fetchPage(PAGE);

    expect(read.ok && text(read.page.bytes)).toBe("<head><b");
    expect(stream.cancelled()).toBe(true);
  });

  it("refuses a cover its site says is over the cap without reading it, and one that runs past it", async () => {
    const declared = chunked(["0123456789"]);
    const big = createPageFetch(
      answering(() => new Response(declared.body, { headers: { "content-length": "10" } })),
      HEADERS,
    );
    await expect(big(COVER)).resolves.toMatchObject(NOT_READ);
    expect(declared.cancelled()).toBe(true);

    const undeclared = chunked(["01234", "56789"]);
    const runs = createPageFetch(
      answering(() => new Response(undeclared.body)),
      HEADERS,
    );
    await expect(runs(COVER)).resolves.toMatchObject(NOT_READ);
  });

  it("gives up on a page that never answered, and reads none it could not reach", async () => {
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
    await expect(reading).resolves.toMatchObject(NOT_READ);

    const offline = createPageFetch(
      async () => await Promise.reject(new TypeError("Network request failed")),
      HEADERS,
    );
    await expect(offline(PAGE)).resolves.toMatchObject(NOT_READ);
  });

  it("follows a redirect itself, resolved against the hop it came from, and reads where it ended", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const answers = new Map<string, () => Response>([
      [PAGE.url, () => new Response(null, { headers: { location: "/moved" }, status: 301 })],
      [
        "https://stephango.com/moved",
        () =>
          new Response(null, { headers: { location: "https://cdn.example.com/p" }, status: 302 }),
      ],
      ["https://cdn.example.com/p", () => new Response("<p>here</p>")],
    ]);
    const fetchPage = createPageFetch(async (url, init) => {
      seen.push({ init, url });
      return await Promise.resolve(answers.get(url)?.() ?? new Response("", { status: 404 }));
    }, HEADERS);

    const read = await fetchPage({ ...PAGE, maxBytes: 64 });

    expect(read.ok && read.page.url).toBe("https://cdn.example.com/p");
    expect(seen.map((each) => each.url)).toStrictEqual([
      PAGE.url,
      "https://stephango.com/moved",
      "https://cdn.example.com/p",
    ]);
    expect(seen.every((each) => each.init.redirect === "manual")).toBe(true);
  });

  it("never follows a public page's redirect into private space, in any spelling", async () => {
    for (const location of [
      "http://192.168.1.1/apply.cgi",
      "http://192.168.1/x.png",
      "http://router.local/",
      "http://localhost:8080/",
    ]) {
      const seen: string[] = [];
      const fetchPage = createPageFetch(async (url) => {
        seen.push(url);
        return await Promise.resolve(new Response(null, { headers: { location }, status: 302 }));
      }, HEADERS);

      await expect(fetchPage(PAGE), location).resolves.toMatchObject(NOT_READ);
      expect(seen, location).toStrictEqual([PAGE.url]);
    }
  });

  it("follows a private saved address's redirect within the person's own network", async () => {
    const saved = "http://192.168.1.20/notes";
    const fetchPage = createPageFetch(
      async (url) =>
        await Promise.resolve(
          url === saved
            ? new Response(null, { headers: { location: "/notes/" }, status: 307 })
            : new Response("<p>nas</p>"),
        ),
      HEADERS,
    );

    const read = await fetchPage({ ...PAGE, maxBytes: 64, from: saved, url: saved });

    expect(read.ok && read.page.url).toBe("http://192.168.1.20/notes/");
  });

  it("goes back into private space from nowhere but private space, however the walk began", async () => {
    const saved = "http://go/x";
    const seen: string[] = [];
    const answers = new Map<string, string>([
      [saved, "https://public.example.com/a"],
      ["https://public.example.com/a", "http://10.0.0.5/admin"],
    ]);
    const fetchPage = createPageFetch(async (url) => {
      seen.push(url);
      return await Promise.resolve(
        new Response(null, { headers: { location: answers.get(url) ?? "" }, status: 302 }),
      );
    }, HEADERS);

    await expect(fetchPage({ ...PAGE, from: saved, url: saved })).resolves.toMatchObject(NOT_READ);
    expect(seen).toStrictEqual([saved, "https://public.example.com/a"]);
  });

  it("asks nothing in private space of what a public address named", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchPage = createPageFetch(
      answering(() => new Response(""), seen),
      HEADERS,
    );

    await expect(fetchPage({ ...COVER, url: "http://10.0.0.5/cam.png" })).resolves.toMatchObject(
      NOT_READ,
    );
    expect(seen).toStrictEqual([]);
  });

  it("stops after five redirects", async () => {
    let hops = 0;
    const fetchPage = createPageFetch(async () => {
      hops += 1;
      return await Promise.resolve(
        new Response(null, { headers: { location: `/hop-${String(hops)}` }, status: 302 }),
      );
    }, HEADERS);

    await expect(fetchPage(PAGE)).resolves.toMatchObject(NOT_READ);
    expect(hops).toBe(6);
  });

  it("asks a public page nothing over plain http, which iOS would refuse", async () => {
    const seen: string[] = [];
    const fetchPage = createPageFetch(async (url) => {
      seen.push(url);
      return await Promise.resolve(
        new Response(null, { headers: { location: "http://example.com/plain" }, status: 301 }),
      );
    }, HEADERS);

    await expect(fetchPage({ ...PAGE, url: "http://example.com/a" })).resolves.toMatchObject(
      NOT_READ,
    );
    await expect(fetchPage(PAGE)).resolves.toMatchObject(NOT_READ);
    expect(seen).toStrictEqual([PAGE.url]);
  });
});
