import { useEffect, useState } from "react";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";

import { currentSession } from "@/lib/session-guard";

// ---------------------------------------------------------------------------
// `/app/link` — where a deep link lands.
//
// The Worker's link endpoint is a POST for a reason (deep-link-route.ts): a GET
// a page can cause is a CSRF write. So the navigable half is here, in a client
// that already holds the user's session: it reads the verb out of its own
// query, calls the endpoint with the bearer, and then gets out of the way.
//
// The desktop shell forwards `inteligir://` here (apps/desktop
// deep-link-route.ts) rather than acting on a link itself; a browser reaches
// the same URL directly. Neither is trusted with more than the query — the
// grammar, the sanitization and the target note are all decided server-side.
// ---------------------------------------------------------------------------

/** What the page shows while the round trip is in flight, and after. */
type LinkState = { done: false } | { done: true; error: string | null };

export const Route = createFileRoute("/app/link")({
  beforeLoad: async () => {
    const session = await currentSession();
    if (session === null) throw redirect({ to: "/app/sign-in" });
    return { session };
  },
  component: LinkRoute,
});

function LinkRoute() {
  const { session } = Route.useRouteContext();
  const router = useRouter();
  const [state, setState] = useState<LinkState>({ done: false });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // The query is forwarded whole: the Worker re-joins it into the scheme
      // URL its one parser already knows how to refuse, so narrowing it here
      // would only add a second grammar to keep in step.
      const query = new URL(window.location.href).search;
      const response = await fetch(`/v1/host/${encodeURIComponent(session.userId)}/link${query}`, {
        method: "POST",
        headers: { authorization: `Bearer ${session.token}` },
      }).catch(() => null);
      if (cancelled) return;
      if (response === null || !response.ok) {
        setState({ done: true, error: "That link couldn't be opened." });
        return;
      }
      setState({ done: true, error: null });
      // A nav arrives over the socket the workspace opens, and a capture has
      // already landed in the inbox — either way the workspace is where the
      // user should be, so this route never stays on screen.
      void router.navigate({ to: "/app", replace: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [router, session.token, session.userId]);

  return (
    <main className="flex min-h-dvh items-center justify-center px-6 text-center">
      <p className="text-sm text-muted-foreground">
        {state.done && state.error !== null ? state.error : "Opening…"}
      </p>
    </main>
  );
}
