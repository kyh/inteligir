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
 */
export async function currentSession(): Promise<ActiveSession | null> {
  const { activeSession } = await import("@/lib/auth-client");
  return activeSession();
}
