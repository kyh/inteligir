import { useState } from "react";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";

import {
  buildPairCallbackUrl,
  DEVICE_API_PATHS,
  type MintPairingCodeRequest,
  mintPairingCodeResponseSchema,
  pairApproveSearchSchema,
  type PairApproveSearch,
  pairRedirectKind,
  type PairRedirectKind,
} from "@repo/api/cloud/pairing/pairing-schema";
import { Button } from "@repo/ui/components/button";

import { AuthError } from "@/components/auth-shell";
import { currentSession } from "@/lib/session-guard";
import { siteConfig } from "@/lib/site-config";

// The redirect target is validated at parse by the contract schema; without that,
// `?redirect=` is an open redirect handing a live pairing code to any origin. The PKCE
// challenge is forwarded, never generated here: the app keeps the verifier, so a code read
// off the redirect cannot be redeemed. ssr: false because everything depends on the session.

export const Route = createFileRoute("/app/pair")({
  ssr: false,
  validateSearch: (search): Partial<PairApproveSearch> => {
    const parsed = pairApproveSearchSchema.safeParse(search);
    // a refusal keeps the URL so the page renders its "not a pairing request" state instead of an error boundary
    return parsed.success ? parsed.data : {};
  },
  beforeLoad: async ({ location }): Promise<{ accountEmail: string | null }> => {
    if (import.meta.env.SSR) return { accountEmail: null };
    const session = await currentSession();
    if (session === null) {
      // location.href, not a rebuilt URL: every param, `state` above all, must survive the sign-in round trip
      throw redirect({ to: "/app/sign-in", search: { next: location.href } });
    }
    // shown on the page so a shared browser session cannot silently pair a device to the wrong account
    return { accountEmail: session.email };
  },
  component: PairPage,
});

const MOBILE_REARM_MS = 4_000;

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
          Start pairing from the app — Settings → Devices, or <code>inteligir cloud pair</code> —
          and use the page it opens.
        </p>
      </PairShell>
    );
  }

  const { redirect: callback, state, name, challenge } = search;
  const callbackKind = pairRedirectKind(callback);

  // the deep-link callback's host parses to "pair", so its line names the app instead
  const returnAddress = {
    mobile: () => <>Approving sends you back to the {siteConfig.name} app on this phone.</>,
    loopback: () => (
      <>
        Approving sends you back to <code>{new URL(callback).host}</code> — the app on that machine.
      </>
    ),
  } satisfies Record<PairRedirectKind, () => React.ReactNode>;

  // busy re-arms on a timer for the deep link only: a loopback assignment always unloads this
  // page, but a custom-scheme launch hands off to the OS without unloading it, and a refused
  // launch leaves the user here
  const onApprove = () => {
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const code = await mintCode(challenge);
        // a top-level navigation, not a fetch: only the browser can reach the local app's loopback
        window.location.assign(buildPairCallbackUrl(callback, { code, state }));
        if (callbackKind === "mobile") {
          window.setTimeout(() => setBusy(false), MOBILE_REARM_MS);
        }
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
          {callbackKind === null ? null : returnAddress[callbackKind]()}
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
