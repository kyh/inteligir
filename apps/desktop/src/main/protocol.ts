// THE RENDERER'S ONLY DOOR.
//
// Serving the workspace from a custom scheme makes `http://127.0.0.1:<port>`
// cross-origin to it — so rather than putting CORS on the loopback server, the
// renderer's whole traffic arrives on `inteligir://`: the bundle, `/rpc` and
// `/vault/asset` alike. Same-origin throughout, no CORS anywhere, and THE
// RENDERER NEVER HOLDS THE TOKEN — this handler attaches it in main, where the
// page cannot read it.
//
// The scheme is registered `standard` so Chromium gives it a real origin (the
// pin depends on that) and `supportFetchAPI` so `fetch` may reach it at all;
// `stream: true` is for the asset route's media, which is served as bytes.
//
// The one thing that does NOT come through here is a WEBSOCKET: a browser
// `WebSocket` cannot be proxied by a protocol handler, so those dial the
// loopback origin directly and main attaches the bearer to the upgrade
// (`index.ts`, `onBeforeSendHeaders`).

import { net, protocol, type Session } from "electron";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { websocketOrigin } from "@repo/api/local/routes";
import { bundleFile, isProxiedPath } from "./credential-scope";
import { authorizationHeader } from "inteligir/server/server-file";
import { documentSecurityHeaders } from "inteligir/server/csp";

const APP_SCHEME = "inteligir";

/** A HOST, not nothing: `inteligir:///` has no origin to pin, and the pin's
 *  comparison has to have two parts to compare. */
const APP_HOST = "app";

export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/** Registered BEFORE `app.whenReady`, which Electron enforces. */
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
  /** `http://127.0.0.1:<bound port>` — where the proxied half goes. */
  serverOrigin: string;
  /** This instance's device token, attached in MAIN and never handed out. */
  token: string;
  /** The built renderer, or a dev server's origin when one is running. */
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
      // The body is READ rather than forwarded as a stream: Electron's
      // `net.fetch` takes no `duplex`, so a streamed body is not an option
      // here — and every proxied call is one RPC envelope or a bare GET, which
      // is small by construction. #611's STOP condition (abandon the proxy if it
      // measurably costs interaction latency) is judged clear by inspection: the
      // added work is one in-memory buffer copy of a small envelope plus a
      // loopback hop, both far below a frame — the fallback CORS path is not
      // needed and would only widen the token's exposure.
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
    // Every path the router owns is the SPA shell; only a MISSING asset is a
    // 404, because answering one with HTML hands the module loader a document
    // and produces an opaque MIME error instead.
    if (pathname.startsWith("/assets/")) {
      return new Response("Not found", { status: 404 });
    }
    const shell = await net.fetch(pathToFileURL(join(args.renderer.dir, "index.html")).toString());
    return withDocumentPolicy(shell, documentHeaders);
  });
}

/** The policy rides the DOCUMENT and nothing else — it is the only response
 *  that can execute anything. Headers are rebuilt rather than mutated: a
 *  streamed Response may carry immutable ones, and a set that silently no-ops
 *  would ship a document with no policy on it. */
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
