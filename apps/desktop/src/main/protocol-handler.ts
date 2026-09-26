// what `inteligir://` answers, over an injected fetch: protocol.ts hands it Electron's net.fetch,
// a test a fake. no `electron` import, so it stays unit-testable.

import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { HTML_FRAME_PATH } from "@repo/api/local/routes";
import { HTML_FRAME_DOCUMENT, HTML_FRAME_HEADERS } from "inteligir/server/html-block-frame";
import { authorizationHeader } from "inteligir/server/server-file";
import { bundleFile, isProxiedPath } from "./credential-scope";
import type { LiveServer } from "./server-instance";

export const APP_SCHEME = "inteligir";

// `inteligir:///` has no origin to pin.
const APP_HOST = "app";

export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

// the page, or no one: absent is a request the browser started itself. a sandboxed note frame
// is opaque and answers "null", and its reach into /rpc is exactly the one this refuses.
export const carriesBearer = (initiatorOrigin: string | undefined): boolean =>
  initiatorOrigin === undefined || initiatorOrigin === APP_ORIGIN;

// Electron sets `initiatorOrigin` beside the standard fields, where the Request type cannot see it.
const initiatorSchema = z.object({ initiatorOrigin: z.string().optional() });

export type AppRenderer = { kind: "files"; dir: string } | { kind: "dev"; origin: string };

export interface AppRequestHandlerArgs {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  renderer: AppRenderer;
  // null before the first boot: the first-run page is served, and nothing is behind its API yet
  server: LiveServer | null;
  documentHeaders: Record<string, string>;
}

const notFound = (): Response => new Response("Not found", { status: 404 });

// headers are rebuilt, not mutated: a streamed Response may carry immutable ones and `set` silently no-ops.
const withDocumentPolicy = (
  response: Response,
  documentHeaders: Record<string, string>,
): Response => {
  if (!(response.headers.get("content-type") ?? "").includes("text/html")) {
    return response;
  }
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(documentHeaders)) {
    headers.set(name, value);
  }
  return new Response(response.body, { headers, status: response.status });
};

export const createAppRequestHandler =
  (args: AppRequestHandlerArgs) =>
  async (request: Request): Promise<Response> => {
    const { pathname, search } = new URL(request.url);

    // answered here for both renderers, never from the bundle: `withDocumentPolicy` would hand the
    // frame the page's `script-src 'self'`.
    if (pathname === HTML_FRAME_PATH) {
      return new Response(HTML_FRAME_DOCUMENT, { headers: HTML_FRAME_HEADERS });
    }

    // gated ahead of both renderers: `pnpm dev` serves no CSP, so a note's frame can run there.
    if (isProxiedPath(pathname)) {
      const initiator = initiatorSchema.safeParse(request);
      if (!initiator.success || !carriesBearer(initiator.data.initiatorOrigin)) {
        return new Response("Forbidden", { status: 403 });
      }
      const { server } = args;
      if (server === null) {
        return new Response("No vault is open yet", { status: 503 });
      }
      const headers = new Headers(request.headers);
      headers.set("authorization", authorizationHeader(server.token));
      // buffered, not streamed: Electron's `net.fetch` takes no `duplex`.
      const init: RequestInit = { headers, method: request.method };
      if (request.method !== "GET" && request.method !== "HEAD") {
        init.body = await request.arrayBuffer();
      }
      // a child going away drops the socket mid-request, and an unanswered rejection logs as unhandled.
      const proxied = await args
        .fetch(`${server.origin}${pathname}${search}`, init)
        .catch(() => null);
      return proxied ?? new Response("The inteligir server is not answering", { status: 502 });
    }

    if (args.renderer.kind === "dev") {
      return await args.fetch(`${args.renderer.origin}${pathname}${search}`);
    }

    const file = bundleFile(args.renderer.dir, pathname);
    if (file === null) {
      return notFound();
    }
    const response = await args.fetch(pathToFileURL(file).toString()).catch(() => null);
    if (response !== null && response.ok) {
      return withDocumentPolicy(response, args.documentHeaders);
    }
    // a missing asset answered with the SPA shell hands the module loader HTML and an opaque MIME error.
    if (pathname.startsWith("/assets/")) {
      return notFound();
    }
    const shell = await args.fetch(
      pathToFileURL(path.join(args.renderer.dir, "index.html")).toString(),
    );
    return withDocumentPolicy(shell, args.documentHeaders);
  };
