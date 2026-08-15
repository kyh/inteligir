import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";

import { installAssetUpload, installBridge } from "@repo/bridge/client";
import { createWsBridge, type WsBridgeStatus } from "@repo/bridge/ws-bridge";
import { App } from "@repo/workspace/app-root";
import {
  endWorkspaceSession,
  flushOpenNoteOnly,
} from "@repo/workspace/workspace/workspace-runtime";
import { setAccountPort } from "@repo/workspace/workspace/account-host";

import { uploadHostAsset } from "@/lib/asset-upload";
import { authClient, authErrorMessage, mintSocketTicket } from "@/lib/auth-client";

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
  const navigate = useNavigate();

  useEffect(() => {
    const transport = createWsBridge({
      url: hostSocketUrl(),
      mintTicket: mintSocketTicket,
      onStatus: setStatus,
    });
    installBridge(transport.bridge);
    // The socket's companion transport: a pasted photo is bigger than a frame,
    // and this origin serves the route that streams it.
    installAssetUpload(uploadHostAsset);
    // Sign-out is deliberately NOT a Bridge call: it invalidates the very
    // credential that socket authenticated with, so it belongs to the surface
    // holding it.
    //
    // The open note is flushed and every account-scoped store is reset FIRST
    // (@repo/workspace/workspace/workspace-runtime), while the socket is still
    // live — which is what earns the router navigate. This used to be
    // `location.assign`, and the reload was load-bearing: several stores latch
    // on first init and never clear, so a navigate alone left the next account
    // reading the previous one's answers.
    setAccountPort({
      email,
      signOut: async () => {
        await endWorkspaceSession();
        await authClient.signOut();
        await navigate({ to: "/app/sign-in" });
      },
      // A same-origin path, not a fetch: the host streams a zip of the whole
      // vault and the browser writes it straight to disk.
      exportVaultUrl: "/v1/host/export",
      // Also not a Bridge call — deleting the account destroys the very object
      // that socket talks to, so the request belongs to the surface holding the
      // credential. Better Auth's own hook is what purges the host (see the
      // Worker's auth.ts).
      deleteAccount: async (password) => {
        // Only the FLUSH precedes the delete: `purgeAccount` closes every
        // socket with 4401 as its first act, so a flush aimed after it waits
        // out the whole timeout against a host that no longer exists.
        //
        // The rest of the teardown must NOT precede it. This call fails on an
        // ordinary wrong password, and the caller keeps the workspace mounted
        // to show the error — a workspace whose stores had already been reset
        // would still be sitting there, with no open note and no way back
        // short of a reload.
        await flushOpenNoteOnly();
        const { error } = await authClient.deleteUser(password === null ? {} : { password });
        if (error !== null) return { ok: false, error: authErrorMessage(error) };
        await endWorkspaceSession();
        await navigate({ to: "/app/sign-in" });
        return { ok: true };
      },
    });
    setReady(true);
    return transport.dispose;
  }, [email, navigate]);

  // Terminal: the session behind the ticket is gone and the bridge's supervisor
  // has stopped, so a live UI would sit there hanging. Replace it with the one
  // action that can help — but END THE SESSION first. Signing out is not the
  // only way one ends: an expired session lands here, and the sign-in that
  // follows renders in the SAME document, so without this every store would
  // still hold the previous account's answers.
  useEffect(() => {
    if (status === "unauthorized") void endWorkspaceSession();
  }, [status]);

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
