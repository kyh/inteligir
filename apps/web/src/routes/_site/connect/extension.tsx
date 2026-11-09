import { useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { EXTENSION_STORE_URL } from "@repo/contract/extension/extension-identity";
import { Button } from "@repo/ui/components/button";

import { AuthShell } from "#components/auth-shell";
import { tellExtension } from "#lib/extension-connect";
import type { ConnectOutcome } from "#lib/extension-connect";
import { currentSession } from "#lib/session-guard";

// The browser extension's connection: the person signed in here clicks Connect, and the extension
// in this browser learns where the site is and saves to the account this browser is signed in to
// (src/lib/extension-connect.ts). ssr: false, since it reads the live session and talks to the
// extension, which only the client can.

const outcomeText = (outcome: ConnectOutcome): string => {
  switch (outcome.kind) {
    case "connected": {
      return `Connected. What you save from this browser now goes to the library of ${outcome.email}.`;
    }
    case "no-extension": {
      return "The Inteligir extension isn't in this browser yet. Add it, then come back here.";
    }
    case "no-sign-in": {
      return "The extension couldn't find your sign-in in this browser. Try again.";
    }
    // no default
  }
};

const Outcome = ({ outcome }: { outcome: ConnectOutcome }) => (
  <div className="grid gap-2 text-sm">
    <p>{outcomeText(outcome)}</p>
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
  const [pending, setPending] = useState(false);

  const connect = async () => {
    setPending(true);
    setOutcome(await tellExtension(window.chrome?.runtime));
    setPending(false);
  };

  return (
    <AuthShell
      title="Connect the browser extension"
      subtitle="Let the Inteligir extension in this browser save to your library."
      footer="It stays signed in while this browser is. Signing out here signs it out too."
    >
      <div className="grid gap-4">
        {outcome === null ? null : <Outcome outcome={outcome} />}
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

export const Route = createFileRoute("/_site/connect/extension")({
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
