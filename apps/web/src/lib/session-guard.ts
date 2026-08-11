import type { ActiveSession } from "@/lib/auth-client";

/**
 * The signed-in session, with Better Auth's client behind a dynamic import.
 *
 * Every `/app` route guards on this, and a route guard lives in the half of a
 * route module the code-splitter cannot move — so a STATIC import here would
 * put Better Auth's client (~50 KB with its fetch layer) in the entry chunk
 * that every page loads, marketing included, where there is no auth surface at
 * all. The extra round trip is paid only on the way into an app route, which is
 * already fetching the workspace.
 *
 * On the server the answer is `null`, and that is established rather than
 * assumed: the only guarded route that server-renders is one gated by
 * `ssrWhenSignedOut`, which admits a request precisely when it carries no
 * session cookie. The direction is the safe one either way — a server-side
 * `null` can only ever send someone TO the sign-in page, never past it.
 */
export async function currentSession(): Promise<ActiveSession | null> {
  if (import.meta.env.SSR) return null;
  const { activeSession } = await import("@/lib/auth-client");
  return activeSession();
}

/**
 * The `ssr` option for a guarded route whose form is worth server-rendering.
 *
 * The absence of a Better Auth session cookie is the one session fact a render
 * can establish for free — no cookie, no session — and `getSessionCookie` is
 * Better Auth's own reader for it. Those requests server-render, so the page
 * arrives as HTML and paints before any JavaScript does. A request that DOES
 * carry a cookie may hold a live session or a dead one, and only
 * `/api/auth/get-session` can tell the two apart; the cookie is `httpOnly`, so
 * that check belongs to the browser. Those requests stay client-rendered and
 * reach `currentSession` there, where the guard and its redirect are unchanged.
 *
 * Validating it here instead would mean this Worker fetching its own
 * `/api/auth/*`, and it is mounted on zone ROUTES: Cloudflare sends a
 * same-zone subrequest to the origin with Workers skipped, so the call
 * resolves under miniflare and fails only once deployed. Even where it worked
 * it would add a round trip to the render of the very page a signed-out
 * visitor is waiting on, to establish what the missing cookie already proved.
 */
export async function ssrWhenSignedOut(): Promise<boolean | undefined> {
  // The router reads `ssr` on the server only. `import.meta.env.SSR` folds per
  // build environment, so this returns before the client bundle would have to
  // carry a server-only import; the value it returns there is never read.
  if (!import.meta.env.SSR) return undefined;
  const { getRequest } = await import("@tanstack/react-start/server");
  const { getSessionCookie } = await import("better-auth/cookies");
  return getSessionCookie(getRequest()) === null;
}
