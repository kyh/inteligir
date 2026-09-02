import type { ActiveSession } from "@/lib/auth-client";

// Dynamic import: a route guard cannot be code-split, so a static import would put Better
// Auth's client in the entry chunk every marketing page loads. On the server the answer is
// null, which can only send someone to sign-in, never past it.
export async function currentSession(): Promise<ActiveSession | null> {
  if (import.meta.env.SSR) return null;
  const { activeSession } = await import("@/lib/auth-client");
  return activeSession();
}

// Server-render only requests with no session cookie; a cookie may be dead, and only
// /api/auth/get-session can tell. Not validating here: this Worker is on zone routes, and a
// same-zone subrequest skips Workers, so a self-fetch works under miniflare and fails deployed.
export async function ssrWhenSignedOut(): Promise<boolean | undefined> {
  // import.meta.env.SSR folds per build, so the client bundle never carries the server-only imports below
  if (!import.meta.env.SSR) return undefined;
  const { getRequest } = await import("@tanstack/react-start/server");
  const { getSessionCookie } = await import("better-auth/cookies");
  return getSessionCookie(getRequest()) === null;
}
