import { useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import { EXTENSION_STORE_URL } from "@repo/contract/cloud/extension/extension-identity";
import { refusalText } from "@repo/contract/cloud/refusal-text";
import { V1_RPC_PATH } from "@repo/contract/cloud/v1";
import type { V1Client } from "@repo/contract/cloud/v1";
import { Button } from "@repo/ui/components/button";

import { AuthError, AuthShell, CONNECTION_FAILED } from "@/components/auth-shell";
import { askExtension, connectExtension } from "@/lib/extension-connect";
import type { ConnectOutcome } from "@/lib/extension-connect";
import { currentSession } from "@/lib/session-guard";

// The browser extension's sign-in: the person signed in here clicks Connect, and the extension in
// this browser is handed a credential of its own for their account (src/lib/extension-connect.ts).
// ssr: false, since it reads the live session and talks to the extension, which only the client can.

// the name the extension's device row takes on the devices page
const DEVICE_NAME = "Browser extension";

// the page's own calls: its session's cookie, or the credential it minted, to this origin
const v1Client = (credential: string | null): V1Client =>
  createORPCClient<V1Client>(
    new RPCLink({
      headers: credential === null ? {} : { authorization: `Bearer ${credential}` },
      origin: window.location.origin,
      url: V1_RPC_PATH,
    }),
  );

const OUTCOME_TEXT = {
  connected: "Connected. What you save from this browser now goes to your library.",
  "no-extension": "The Inteligir extension isn't in this browser yet. Add it, then come back here.",
  "not-taken": "The extension didn't take the connection. Try again.",
} satisfies Record<ConnectOutcome["kind"], string>;

const Outcome = ({ outcome }: { outcome: ConnectOutcome }) => (
  <div className="grid gap-2 text-sm">
    <p>{OUTCOME_TEXT[outcome.kind]}</p>
    {outcome.kind === "no-extension" ? (
      <a
        className="underline underline-offset-4"
        href={EXTENSION_STORE_URL}
        rel="noreferrer"
        target="_blank"
      >
        Get the Inteligir extension
      </a>
    ) : null}
  </div>
);

const ConnectExtensionPage = () => {
  const [outcome, setOutcome] = useState<ConnectOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const connect = async () => {
    setPending(true);
    setError(null);
    try {
      setOutcome(
        await connectExtension({
          ask: async (request) => await askExtension(window.chrome?.runtime, request),
          mint: async () =>
            await v1Client(null).account.connectExtension({ deviceName: DEVICE_NAME }),
          revoke: async (credential) => {
            await v1Client(credential).account.signOut();
          },
        }),
      );
    } catch (error_) {
      setError(refusalText(error_, CONNECTION_FAILED));
    }
    setPending(false);
  };

  return (
    <AuthShell
      title="Connect the browser extension"
      subtitle="Let the Inteligir extension in this browser save to your library."
      footer="You can disconnect it from the extension, or revoke it on your devices page."
    >
      <div className="grid gap-4">
        {outcome === null ? null : <Outcome outcome={outcome} />}
        <AuthError message={error} />
        {outcome?.kind === "connected" ? null : (
          <Button
            disabled={pending}
            onClick={() => {
              void connect();
            }}
            type="button"
          >
            {pending ? "Connecting…" : "Connect"}
          </Button>
        )}
      </div>
    </AuthShell>
  );
};

export const Route = createFileRoute("/connect/extension")({
  ssr: false,
  // a page for the person already signed in, never a search result
  head: () => ({ meta: [{ content: "noindex, nofollow", name: "robots" }] }),
  beforeLoad: async ({ location }) => {
    const session = await currentSession();
    if (session.kind === "signed-out") {
      redirect({ search: { next: location.href }, throw: true, to: "/app/sign-in" });
    }
    if (session.kind === "unknown") {
      throw new Error(session.message);
    }
  },
  component: ConnectExtensionPage,
});
