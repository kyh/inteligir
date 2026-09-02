// the renderer's traffic all arrives on `inteligir://` and the bearer is attached here, so
// the loopback server needs no CORS and the page never holds the token. websockets are the
// exception: a protocol handler cannot proxy one, so index.ts attaches the bearer to the upgrade.

import { net, protocol, type Session } from "electron";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { websocketOrigin } from "@repo/api/local/routes";
import { bundleFile, isProxiedPath } from "./credential-scope";
import { authorizationHeader } from "inteligir/server/server-file";
import { documentSecurityHeaders } from "inteligir/server/csp";

const APP_SCHEME = "inteligir";

// `inteligir:///` has no origin to pin.
const APP_HOST = "app";

export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

// must run before `app.whenReady`; Electron enforces the ordering.
// `standard` gives Chromium a real origin for the pin; `supportFetchAPI` lets `fetch` reach it at all.
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ]);
}

export interface AppProtocolArgs {
  session: Session;
  serverOrigin: string;
  token: string;
  renderer: { kind: "files"; dir: string } | { kind: "dev"; origin: string };
}

export function registerAppProtocol(args: AppProtocolArgs): void {
  const documentHeaders = documentSecurityHeaders({
    wsOrigin: websocketOrigin(args.serverOrigin),
  });

  args.session.protocol.handle(APP_SCHEME, async (request) => {
    const { pathname, search } = new URL(request.url);

    if (isProxiedPath(pathname)) {
      const headers = new Headers(request.headers);
      headers.set("authorization", authorizationHeader(args.token));
      // buffered, not streamed: Electron's `net.fetch` takes no `duplex`.
      const init: RequestInit = { method: request.method, headers };
      if (request.method !== "GET" && request.method !== "HEAD") {
        init.body = await request.arrayBuffer();
      }
      return net.fetch(`${args.serverOrigin}${pathname}${search}`, init);
    }

    if (args.renderer.kind === "dev") {
      return net.fetch(`${args.renderer.origin}${pathname}${search}`);
    }

    const file = bundleFile(args.renderer.dir, pathname);
    if (file === null) {
      return new Response("Not found", { status: 404 });
    }
    const response = await net.fetch(pathToFileURL(file).toString()).catch(() => null);
    if (response !== null && response.ok) {
      return withDocumentPolicy(response, documentHeaders);
    }
    // a missing asset answered with the SPA shell hands the module loader HTML and an opaque MIME error.
    if (pathname.startsWith("/assets/")) {
      return new Response("Not found", { status: 404 });
    }
    const shell = await net.fetch(pathToFileURL(join(args.renderer.dir, "index.html")).toString());
    return withDocumentPolicy(shell, documentHeaders);
  });
}

// headers are rebuilt, not mutated: a streamed Response may carry immutable ones and `set` silently no-ops.
function withDocumentPolicy(response: Response, documentHeaders: Record<string, string>): Response {
  if (!(response.headers.get("content-type") ?? "").includes("text/html")) {
    return response;
  }
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(documentHeaders)) {
    headers.set(name, value);
  }
  return new Response(response.body, { status: response.status, headers });
}
