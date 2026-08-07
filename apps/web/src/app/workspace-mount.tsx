import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";

import { installBridge } from "@repo/bridge/client";
import { createWsBridge, type WsBridgeStatus } from "@repo/bridge/ws-bridge";
import { App } from "@repo/workspace/app-root";
import { setAccountPort } from "@repo/workspace/workspace/account-host";
import { setHtmlAppRuntime } from "@repo/workspace/workspace/html-app-host";

import { authClient, authErrorMessage, mintSocketTicket } from "@/lib/auth-client";
import { HTML_APPS_DISABLED } from "@/app/html-apps-disabled";

// ---------------------------------------------------------------------------
// Where the workspace meets this host: open the Bridge socket to the user's
// Durable Object, install it, and only then render the app.
//
// `installBridge` before the first render is a hard requirement, not an
// ordering preference — `getBridge()` throws by design, so a component that
// mounts early takes the whole tree down. That is why `App` is behind
// `ready`: the effect installs, and the render that follows is the first one
// the workspace sees.
//
// This module is DYNAMICALLY IMPORTED (see routes/app/index.tsx). Everything
// under `@repo/workspace` — Plate and its ~30 packages — hangs off the import
// below, and nothing else on this site may pay for it: not the marketing
// route's bundle, and not the SSR Worker's.
// ---------------------------------------------------------------------------

/** The user's host socket on this same origin. There is no userId in the path:
 * the host derives the object from the credential the handshake carries. `wss:`
 * follows the page's own scheme so localhost dev over plain http connects. */
function hostSocketUrl(): string {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}/v1/host/ws`;
}

export default function WorkspaceMount({ email }: { email: string }) {
  const [status, setStatus] = useState<WsBridgeStatus>("connecting");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const transport = createWsBridge({
      url: hostSocketUrl(),
      mintTicket: mintSocketTicket,
      onStatus: setStatus,
    });
    installBridge(transport.bridge);
    setHtmlAppRuntime(HTML_APPS_DISABLED);
    // Sign-out is deliberately NOT a Bridge call: it invalidates the very
    // credential that socket authenticated with, so it belongs to the surface
    // holding it. A full reload rather than a router navigate — every store in
    // the workspace is scoped to the account that just ended.
    setAccountPort({
      email,
      signOut: async () => {
        await authClient.signOut();
        window.location.assign("/app/sign-in");
      },
      // A same-origin path, not a fetch: the host streams a zip of the whole
      // vault and the browser writes it straight to disk.
      exportVaultUrl: "/v1/host/export",
      // Also not a Bridge call — deleting the account destroys the very object
      // that socket talks to, so the request belongs to the surface holding the
      // credential. Better Auth's own hook is what purges the host (see the
      // Worker's auth.ts).
      deleteAccount: async (password) => {
        const { error } = await authClient.deleteUser(password === null ? {} : { password });
        if (error !== null) return { ok: false, error: authErrorMessage(error) };
        window.location.assign("/app/sign-in");
        return { ok: true };
      },
    });
    setReady(true);
    return transport.dispose;
  }, [email]);

  // Terminal: the session behind the ticket is gone and the bridge's supervisor
  // has stopped, so a live UI would sit there hanging. Replace it with the one
  // action that can help.
  if (status === "unauthorized") return <SessionRejected />;
  if (!ready) return <Connecting />;

  return (
    <>
      {status === "connected" ? null : <ReconnectingBanner />}
      <App />
    </>
  );
}

function Connecting() {
  return (
    <main className="flex min-h-dvh items-center justify-center">
      <p className="text-sm text-muted-foreground">Connecting…</p>
    </main>
  );
}

/** The bridge owns retries (exponential backoff, queued requests, resubscribed
 * events), so this reports the state and offers nothing to press. */
function ReconnectingBanner() {
  return (
    <div className="fixed inset-x-0 top-0 z-100 bg-muted py-1 text-center text-xs text-muted-foreground">
      Reconnecting…
    </div>
  );
}

function SessionRejected() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-sm">Your session has expired.</p>
      <Link to="/app/sign-in" className="text-sm underline underline-offset-4">
        Sign in again
      </Link>
    </main>
  );
}
