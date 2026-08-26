import { useState } from "react";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";

import {
  buildPairCallbackUrl,
  DEVICE_API_PATHS,
  type MintPairingCodeRequest,
  mintPairingCodeResponseSchema,
  pairApproveSearchSchema,
  type PairApproveSearch,
} from "@repo/api/cloud/pairing/pairing-schema";
import { Button } from "@repo/ui/components/button";

import { AuthError } from "@/components/auth-shell";
import { currentSession } from "@/lib/session-guard";
import { siteConfig } from "@/lib/site-config";

// ---------------------------------------------------------------------------
// `/app/pair` — the one screen in browser-approve pairing (issue #573).
//
// A local install sent the user here with four values: where to send the
// browser back to, the single-use `state` that binds the answer to the request
// that asked for it, the name the device will carry, and the PKCE `challenge`.
// This page's whole job is to name the account being joined, show what
// approving grants, and — on the click — mint a code with the SESSION IT
// ALREADY HAS, bound to that challenge, and hand it back over the redirect.
//
// THE REDIRECT IS VALIDATED AT PARSE, by the contract's own schema. That is the
// security property of this page: without it, `?redirect=` is an open redirect
// that hands a live pairing code to whatever origin asked for one. Nothing here
// re-implements the check — a second copy of a host test is how one of them
// ends up wrong.
//
// THE CHALLENGE IS FORWARDED, NEVER GENERATED HERE. The app kept the verifier;
// the browser only carries the hash and stores it on the code row via the mint.
// An interceptor who reads the code off the redirect still cannot redeem it,
// because redeem demands the verifier the app never sent.
//
// NO NEW WORKER ROUTE. Approve calls the existing session-authed mint; the
// durable credential is still minted only by the local app's own redeem, and
// still never transits this browser.
//
// `ssr: false` for the same reason `/app/devices` carries it: everything here
// depends on the live session, which a server render cannot have.
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/app/pair")({
  ssr: false,
  validateSearch: (search): Partial<PairApproveSearch> => {
    const parsed = pairApproveSearchSchema.safeParse(search);
    // A refusal keeps the URL rather than throwing: the page below renders the
    // "this link is not a pairing request" state, which is a far more useful
    // answer than a router error boundary.
    return parsed.success ? parsed.data : {};
  },
  beforeLoad: async ({ location }): Promise<{ accountEmail: string | null }> => {
    if (import.meta.env.SSR) return { accountEmail: null };
    const session = await currentSession();
    if (session === null) {
      // `location.href` and not a rebuilt URL: every param has to survive the
      // sign-in round trip, and the one that must not be lost is `state`.
      throw redirect({ to: "/app/sign-in", search: { next: location.href } });
    }
    // Named on the page so a shared or ambient browser session cannot silently
    // pair a device to the wrong account — the device would then sync private
    // threads both ways.
    return { accountEmail: session.email };
  },
  component: PairPage,
});

async function mintCode(challenge: string): Promise<string> {
  const body: MintPairingCodeRequest = { challenge, challengeMethod: "S256" };
  const response = await fetch(DEVICE_API_PATHS.mintCode, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("Couldn't mint a pairing code.");
  return mintPairingCodeResponseSchema.parse(await response.json()).code;
}

function PairPage() {
  const search = Route.useSearch();
  const { accountEmail } = Route.useRouteContext();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (
    search.redirect === undefined ||
    search.state === undefined ||
    search.name === undefined ||
    search.challenge === undefined
  ) {
    return (
      <PairShell title="That link isn't a pairing request">
        <p className="mt-1 text-sm text-muted-foreground">
          Start pairing from the app — Settings → Devices, or <code>inteligir sync pair</code> — and
          use the page it opens.
        </p>
      </PairShell>
    );
  }

  const { redirect: callback, state, name, challenge } = search;

  // `busy` is cleared only on the failure path: the success path is a
  // navigation, and a button that came back to life underneath it would mint a
  // second code for a pairing that already has one.
  const onApprove = () => {
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const code = await mintCode(challenge);
        // A top-level assignment, not a fetch: the code has to reach the local
        // app's loopback, and only the browser can go there.
        window.location.assign(buildPairCallbackUrl(callback, { code, state }));
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "Couldn't mint a pairing code.");
        setBusy(false);
      }
    })();
  };

  return (
    <PairShell title="Pair a device">
      <p className="mt-1 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{name}</span> is asking to sync with{" "}
        <span className="font-medium text-foreground">{accountEmail ?? "your account"}</span>.
      </p>
      <ul className="mt-6 grid gap-2 text-sm text-muted-foreground">
        <li>It gets its own credential, which you can revoke from Devices at any time.</li>
        <li>Your threads and their history sync to it, and its threads sync back.</li>
        <li>
          Your notes sync through your account's hosted vault — unless that machine is configured
          with its own git remote.
        </li>
      </ul>
      <div className="mt-6 grid gap-3">
        <Button type="button" onClick={onApprove} disabled={busy}>
          {busy ? "Approving…" : `Approve ${name}`}
        </Button>
        <AuthError message={error} />
        <p className="text-xs text-muted-foreground">
          Approving sends you back to <code>{new URL(callback).host}</code> — the app on that
          machine.
        </p>
      </div>
    </PairShell>
  );
}

function PairShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-lg px-6 py-16">
      <Link to="/" className="mb-8 block text-sm font-medium tracking-tight">
        {siteConfig.name}
      </Link>
      <h1 className="text-lg font-medium tracking-tight">{title}</h1>
      {children}
      <Link
        to="/app/devices"
        className="mt-10 block text-xs text-muted-foreground underline underline-offset-4"
      >
        All devices
      </Link>
    </main>
  );
}
