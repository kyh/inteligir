import { redirect } from "@tanstack/react-router";
import { createMiddleware } from "@tanstack/react-start";
import { getSessionCookie } from "better-auth/cookies";

import type { SessionState } from "#lib/auth-client";
import { signedInLanding, signInHref } from "#lib/next-path";

// A page for someone signed in, asked for with no session cookie, goes to sign in and back before
// the Worker serves any of it. The cookie alone, with no read of its session: that would spend a
// database read on every such document, and a cookie whose session ended is the page's to find.
export const requireSessionCookie = createMiddleware().server(async ({ next, request }) => {
  if (getSessionCookie(request) === null) {
    redirect({ href: signInHref(new URL(request.url)), throw: true });
  }
  return await next();
});

// Dynamic import: a route guard cannot be code-split, so a static import would put Better
// Auth's client in the entry chunk every marketing page loads. On the server the answer is
// signed-out, which can only send someone to sign-in, never past it.
export const currentSession = async (): Promise<SessionState> => {
  if (import.meta.env.SSR) {
    return { kind: "signed-out" };
  }
  const { activeSession } = await import("#lib/auth-client");
  return await activeSession();
};

// sign-in and sign-up skipped for someone already signed in, to where they were going
export const redirectWhenSignedIn = async ({
  search,
}: {
  search: { next?: string };
}): Promise<void> => {
  const session = await currentSession();
  if (session.kind === "signed-in") {
    redirect({ href: signedInLanding(search.next), reloadDocument: true, throw: true });
  }
};

// Server-render only requests with no session cookie; a cookie may be dead, and only
// /api/auth/get-session can tell. Not validating here: this Worker is on zone routes, and a
// same-zone subrequest skips Workers, so a self-fetch works under miniflare and fails deployed.
export const ssrWhenSignedOut = async (): Promise<boolean | undefined> => {
  // import.meta.env.SSR folds per build, so the client bundle never carries the server-only imports below
  if (!import.meta.env.SSR) {
    return undefined;
  }
  const { getRequest } = await import("@tanstack/react-start/server");
  const cookies = await import("better-auth/cookies");
  return cookies.getSessionCookie(getRequest()) === null;
};
