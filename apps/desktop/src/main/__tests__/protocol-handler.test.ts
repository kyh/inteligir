import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { HTML_FRAME_PATH } from "@repo/api/local/routes";
import { HTML_FRAME_DOCUMENT, HTML_FRAME_HEADERS } from "inteligir/server/html-block-frame";
import { authorizationHeader } from "inteligir/server/server-file";
import { APP_ORIGIN, carriesBearer, createAppRequestHandler } from "../protocol-handler";
import type { AppRenderer } from "../protocol-handler";

const SERVER = "http://127.0.0.1:4664";
const TOKEN = "tok_test";
const DIR = "/app/renderer";
const CSP = "default-src 'self'";
const DOCUMENT_HEADERS = { "content-security-policy": CSP };

const BUNDLE = {
  "assets/app.js": { body: "console.log(1)", type: "text/javascript" },
  "index.html": { body: "<!doctype html><title>shell</title>", type: "text/html" },
} satisfies Record<string, { body: string; type: string }>;

const FILES_RENDERER = { dir: DIR, kind: "files" } satisfies AppRenderer;
const DEV_RENDERER = { kind: "dev", origin: "http://localhost:31000" } satisfies AppRenderer;

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

// net.fetch rejects a file that is not there; every other origin answers its own url.
const mount = (renderer: AppRenderer = FILES_RENDERER) => {
  const calls: FetchCall[] = [];
  const handler = createAppRequestHandler({
    documentHeaders: DOCUMENT_HEADERS,
    fetch: async (url, init) => {
      calls.push({ init, url });
      if (!url.startsWith("file:")) {
        return new Response(`answered ${url}`);
      }
      const entry = Object.entries(BUNDLE).find(
        ([name]) => pathToFileURL(path.join(DIR, name)).toString() === url,
      );
      if (entry === undefined) {
        throw new Error("net::ERR_FILE_NOT_FOUND");
      }
      const [, file] = entry;
      return new Response(file.body, { headers: { "content-type": file.type } });
    },
    renderer,
    serverOrigin: SERVER,
    token: TOKEN,
  });
  return { calls, handler };
};

// Electron hangs the initiator on the Request itself; a request the browser started carries none.
const appRequest = (
  pathname: string,
  options: { init?: RequestInit; initiatorOrigin?: unknown } = {},
): Request => {
  const request = new Request(`${APP_ORIGIN}${pathname}`, options.init);
  return "initiatorOrigin" in options
    ? Object.assign(request, { initiatorOrigin: options.initiatorOrigin })
    : request;
};

describe("the proxied API", () => {
  it("forwards the page's call with its method, query, headers and body, and the bearer", async () => {
    const { calls, handler } = mount();
    const response = await handler(
      appRequest("/rpc/vault/read?x=1", {
        init: {
          body: '{"path":"a.md"}',
          headers: { "content-type": "application/json" },
          method: "POST",
        },
        initiatorOrigin: APP_ORIGIN,
      }),
    );
    expect(await response.text()).toBe(`answered ${SERVER}/rpc/vault/read?x=1`);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    const headers = new Headers(call?.init?.headers);
    expect(call?.init?.method).toBe("POST");
    expect(headers.get("authorization")).toBe(authorizationHeader(TOKEN));
    expect(headers.get("content-type")).toBe("application/json");
    expect(await new Response(call?.init?.body).text()).toBe('{"path":"a.md"}');
  });

  it("lends the bearer to a request the browser started itself", async () => {
    const { calls, handler } = mount();
    await handler(appRequest("/vault/asset?path=a.png"));
    expect(calls.map((call) => call.url)).toEqual([`${SERVER}/vault/asset?path=a.png`]);
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe(
      authorizationHeader(TOKEN),
    );
  });

  it.each([
    ["a sandboxed note frame's opaque origin", "null"],
    ["another origin", "https://example.com"],
    ["the loopback server's own origin", SERVER],
    ["a look-alike app origin", "inteligir://evil"],
    ["an initiator it cannot read", 42],
  ])("refuses %s with a 403 and forwards nothing", async (_label, initiatorOrigin) => {
    const { calls, handler } = mount();
    const response = await handler(
      appRequest("/rpc/threads/start", { init: { body: "{}", method: "POST" }, initiatorOrigin }),
    );
    expect(response.status).toBe(403);
    expect(calls).toEqual([]);
  });

  it("answers a 502 when the server drops the request as it goes away", async () => {
    const handler = createAppRequestHandler({
      documentHeaders: DOCUMENT_HEADERS,
      fetch: () => Promise.reject(new Error("net::ERR_EMPTY_RESPONSE")),
      renderer: FILES_RENDERER,
      serverOrigin: SERVER,
      token: TOKEN,
    });
    const response = await handler(
      appRequest("/rpc/vault/read", { init: { body: "{}", method: "POST" } }),
    );
    expect(response.status).toBe(502);
  });

  it("gates the proxy in dev too, where the page carries no CSP", async () => {
    const { calls, handler } = mount({ kind: "dev", origin: "http://localhost:31000" });
    const refused = await handler(
      appRequest("/rpc/threads/start", {
        init: { body: "{}", method: "POST" },
        initiatorOrigin: "null",
      }),
    );
    expect(refused.status).toBe(403);
    expect(calls).toEqual([]);

    await handler(appRequest("/src/main.tsx", { initiatorOrigin: APP_ORIGIN }));
    expect(calls.map((call) => call.url)).toEqual(["http://localhost:31000/src/main.tsx"]);
    expect(calls[0]?.init).toBeUndefined();
  });
});

describe("the bundle", () => {
  it("stamps the document policy on HTML, never on a script", async () => {
    const { handler } = mount();
    const shell = await handler(appRequest("/index.html"));
    expect(shell.headers.get("content-security-policy")).toBe(CSP);
    const script = await handler(appRequest("/assets/app.js", { initiatorOrigin: APP_ORIGIN }));
    expect(await script.text()).toBe("console.log(1)");
    expect(script.headers.get("content-security-policy")).toBeNull();
  });

  it("answers a deep link with the shell, policy included", async () => {
    const { handler } = mount();
    const response = await handler(appRequest("/notes/today"));
    expect(await response.text()).toBe(BUNDLE["index.html"].body);
    expect(response.headers.get("content-security-policy")).toBe(CSP);
  });

  it("answers a missing asset with a 404, never the shell's HTML", async () => {
    const { handler } = mount();
    const response = await handler(appRequest("/assets/gone-abc123.js"));
    expect(response.status).toBe(404);
  });

  it("never reads outside the bundle, however the path is spelled", async () => {
    const { calls, handler } = mount();
    const traversal = await handler(appRequest("/assets/..%2f..%2f..%2fetc%2fpasswd"));
    expect(traversal.status).toBe(404);
    await handler(appRequest("/..%2f..%2fetc%2fpasswd"));
    const root = pathToFileURL(`${DIR}/`).toString();
    expect(calls.every((call) => call.url.startsWith(root))).toBe(true);
    const undecodable = await handler(appRequest("/%"));
    expect(undecodable.status).toBe(404);
  });

  it("never forwards a bundle path to the server", async () => {
    const { calls, handler } = mount();
    await handler(appRequest("/rpcx/steal", { initiatorOrigin: APP_ORIGIN }));
    expect(calls.some((call) => call.url.startsWith(SERVER))).toBe(false);
  });
});

describe("a note's html frame", () => {
  it.each([FILES_RENDERER, DEV_RENDERER])(
    "is answered under its own sandbox policy, never the page's, by the $kind renderer",
    async (renderer) => {
      const { calls, handler } = mount(renderer);
      const response = await handler(appRequest(HTML_FRAME_PATH, { initiatorOrigin: APP_ORIGIN }));
      expect(await response.text()).toBe(HTML_FRAME_DOCUMENT);
      expect(response.headers.get("content-security-policy")).toBe(
        HTML_FRAME_HEADERS["content-security-policy"],
      );
      expect(calls).toEqual([]);
    },
  );
});

describe("carriesBearer", () => {
  it.each([
    [APP_ORIGIN, true],
    [undefined, true],
    ["null", false],
    ["inteligir://evil", false],
    [SERVER, false],
    ["", false],
  ])("%s → %s", (initiatorOrigin, expected) => {
    expect(carriesBearer(initiatorOrigin)).toBe(expected);
  });
});
