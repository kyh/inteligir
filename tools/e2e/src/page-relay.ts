import { once } from "node:events";
import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import { z } from "zod";

type PageAnswer =
  | { readonly body: string | Uint8Array<ArrayBuffer>; readonly type?: string }
  | { readonly status: number };

export interface Web {
  readonly pages: Map<string, PageAnswer>;
  readonly pageUrl: (pathname: string) => string;
  readonly fetched: string[];
  readonly strays: string[];
}

type PageProtocol = "http:" | "https:";

export interface PageRelay {
  readonly url: string;
  readonly pageHost: (protocol?: PageProtocol) => Web;
  readonly strays: readonly string[];
  readonly close: () => Promise<void>;
}

const answer = (response: ServerResponse, page?: PageAnswer) => {
  if (page === undefined) {
    response.writeHead(502).end("no page answers here");
  } else if ("status" in page) {
    response.writeHead(page.status).end("not found");
  } else {
    response.writeHead(200, { "content-type": page.type ?? "text/html; charset=utf-8" });
    response.end(page.body);
  }
};

export const servePageRelay = async () => {
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
  } satisfies PageRelay;
};
