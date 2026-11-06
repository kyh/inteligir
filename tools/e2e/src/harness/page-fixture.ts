// a page server on loopback, for the pages a scenario saves, and nothing past this machine
// (§0.2.9). The phone's runtime reads it at its loopback address, since the phone's fetch has no
// address guard; the Worker's fill reads it at `PAGE_HOST`, a public name the Worker host answers
// from this server (`./worker-host.ts`), so the fill's guard judges it as it judges any site's.

import { once } from "node:events";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";

// a name in `.test`, which no resolver answers (RFC 6761), so no fetch of it reaches past the
// Worker host
const PAGE_HOST = "pages.inteligir.test";

export interface PageRoute {
  status?: number;
  // the content type; text/html by default
  type?: string;
  body?: string | Uint8Array;
  // answers 302 to this location
  redirect?: string;
}

export interface PageFixture {
  // the server's own loopback origin
  origin: string;
  url: (path: string) => string;
  // the same path under `PAGE_HOST`, as the Worker's fill is asked to read it
  publicUrl: (path: string) => string;
  // `cloudWorker`'s `pages`, which routes `PAGE_HOST` here
  pages: Readonly<Record<string, string>>;
  requests: () => readonly string[];
  close: () => Promise<void>;
}

const pathOf = (request: IncomingMessage): string => (request.url ?? "/").split("?")[0] ?? "/";

const answer = (response: ServerResponse, route: PageRoute | undefined): void => {
  if (route === undefined) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
    return;
  }
  if (route.redirect !== undefined) {
    response.writeHead(route.status ?? 302, { location: route.redirect });
    response.end();
    return;
  }
  response.writeHead(route.status ?? 200, {
    "content-type": route.type ?? "text/html; charset=utf-8",
  });
  response.end(route.body ?? "");
};

// `address()` answers a pipe name, an AddressInfo or null; a bound TCP port wants only the second
const boundPortSchema = z.object({ port: z.number().int() });

export const startPageFixture = async (
  routes: Readonly<Record<string, PageRoute>>,
): Promise<PageFixture> => {
  const seen: string[] = [];
  const server = createServer((request, response) => {
    const path = pathOf(request);
    seen.push(path);
    answer(response, routes[path]);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = boundPortSchema.parse(server.address());
  const origin = `http://127.0.0.1:${String(port)}`;
  return {
    async close() {
      server.closeAllConnections();
      const closed = once(server, "close");
      server.close();
      await closed;
    },
    origin,
    pages: { [PAGE_HOST]: origin },
    publicUrl: (path) => `http://${PAGE_HOST}${path}`,
    requests: () => seen,
    url: (path) => `${origin}${path}`,
  };
};
