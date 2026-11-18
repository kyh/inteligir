// The web as the app's page fetches reach it under e2e. With PAGE_FETCH_RELAY_URL set, the app sends
// each page fetch here as `GET <relay>?url=<the page>` in place of the network, and the relay answers
// it from the page host of the test that asked for it, or records a stray, which fails that test: no
// flow reaches the open web.

import { once } from "node:events";
import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import { z } from "zod";

// a page by its body (text/html unless `type` says otherwise), or a status with no page
type PageAnswer =
  | { readonly body: string | Uint8Array<ArrayBuffer>; readonly type?: string }
  | { readonly status: number };

// A page host of a test's own: the app's fetches under it are answered from the test's pages and
// logged with it, so a fill that outlives its test is never the next one's.
export interface Web {
  // how the app's fetch of a path under the host is answered
  readonly pages: Map<string, PageAnswer>;
  readonly pageUrl: (pathname: string) => string;
  // every path under the host the app asked for, in order
  readonly fetched: string[];
  // those no page answered, which fail the test
  readonly strays: string[];
}

type PageProtocol = "http:" | "https:";

export interface PageRelay {
  // what the app's PAGE_FETCH_RELAY_URL names
  readonly url: string;
  // a page host no other test has, on http unless the test asks for https
  readonly pageHost: (protocol?: PageProtocol) => Web;
  // every address under no page host the app asked for, which fails the test that was running
  readonly strays: readonly string[];
  readonly close: () => Promise<void>;
}

const answer = (response: ServerResponse, page?: PageAnswer): void => {
  if (page === undefined) {
    response.writeHead(502).end("no page answers here");
  } else if ("status" in page) {
    response.writeHead(page.status).end("not found");
  } else {
    response.writeHead(200, { "content-type": page.type ?? "text/html; charset=utf-8" });
    response.end(page.body);
  }
};

export const servePageRelay = async (): Promise<PageRelay> => {
  // never emptied: a test that ended keeps its host for the fetches it left running
  const hosts = new Map<string, Web>();
  const strays: string[] = [];
  const server = createServer((request, response) => {
    const asked = new URL(request.url ?? "/", "http://relay.invalid").searchParams.get("url") ?? "";
    const url = URL.parse(asked);
    const host = url === null ? undefined : hosts.get(url.origin);
    if (url === null || host === undefined) {
      strays.push(asked);
      answer(response);
      return;
    }
    host.fetched.push(url.pathname);
    const page = host.pages.get(url.pathname);
    if (page === undefined) {
      host.strays.push(url.href);
    }
    answer(response, page);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = z.object({ port: z.number() }).parse(server.address());
  return {
    close: async () => {
      server.close();
      await once(server, "close");
    },
    pageHost: (protocol = "http:") => {
      // a `.test` name no resolver answers (RFC 6761), any site's to the fill's guard
      const host = `${protocol}//${crypto.randomUUID()}.pages.inteligir.test`;
      const web: Web = {
        fetched: [],
        pageUrl: (pathname) => `${host}${pathname}`,
        pages: new Map(),
        strays: [],
      };
      hosts.set(host, web);
      return web;
    },
    strays,
    url: `http://127.0.0.1:${String(port)}`,
  };
};
