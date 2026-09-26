// the renderer's traffic all arrives on `inteligir://` and the bearer is attached here, so
// the loopback server needs no CORS and the page never holds the token. websockets are the
// exception: a protocol handler cannot proxy one, so index.ts attaches the bearer to the upgrade.

import { net, protocol } from "electron";
import type { Session } from "electron";
import { websocketOrigin } from "@repo/api/local/routes";
import { documentSecurityHeaders } from "inteligir/server/csp";
import { APP_SCHEME, createAppRequestHandler } from "./protocol-handler";
import type { AppRenderer } from "./protocol-handler";
import type { LiveServer } from "./server-instance";

// must run before `app.whenReady`; Electron enforces the ordering.
// `standard` gives Chromium a real origin for the pin; `supportFetchAPI` lets `fetch` reach it at all.
export const registerAppScheme = (): void => {
  protocol.registerSchemesAsPrivileged([
    {
      privileges: { secure: true, standard: true, stream: true, supportFetchAPI: true },
      scheme: APP_SCHEME,
    },
  ]);
};

export interface AppProtocolArgs {
  session: Session;
  // null for the first-run window's session, which has no server behind it and dials no socket
  server: LiveServer | null;
  renderer: AppRenderer;
}

export const registerAppProtocol = (args: AppProtocolArgs): void => {
  const { server } = args;
  const handler = createAppRequestHandler({
    documentHeaders: documentSecurityHeaders({
      wsOrigin: server === null ? null : websocketOrigin(server.origin),
    }),
    fetch: async (url, init) => await net.fetch(url, init),
    renderer: args.renderer,
    server,
  });

  // a vault revisited in one launch gets a fresh child and a fresh token, so the handler is
  // replaced; handling a scheme twice on one session throws.
  if (args.session.protocol.isProtocolHandled(APP_SCHEME)) {
    args.session.protocol.unhandle(APP_SCHEME);
  }
  args.session.protocol.handle(APP_SCHEME, handler);
};
