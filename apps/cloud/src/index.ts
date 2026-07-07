import { HEADER_CONTENT_HASH, HEADER_VERSION } from "@repo/core/sync/wire";
import { eq } from "drizzle-orm";
import { createAuth } from "./auth/auth";
import { createDb } from "./db/client";
import { vaultOwner } from "./db/schema";
import { matchRoute } from "./route";
import { VaultCoordinator } from "./vault-coordinator";

// ---------------------------------------------------------------------------
// Worker entry for the vault-sync backend + Better Auth.
//
// ONE Worker serves two surfaces:
//   • /api/auth/*  — Better Auth (email+password, bearer), running in-process
//     over Drizzle + D1 (`createAuth(env).handler`).
//   • /v1/vault/*  — the sync routes (`@repo/core/sync/wire`), forwarded to the
//     per-vault `VaultCoordinator` Durable Object after auth.
//
// AUTH. Clients send `Authorization: Bearer <session-token>` (the token comes
// back in the `set-auth-token` header on sign-in/up). The bearer plugin lets
// `auth.api.getSession({ headers })` validate it in-process — no cross-service
// hop. Ownership is first-writer-wins: the first authenticated user to touch a
// vaultId claims it in the `vault_owner` table; a later request for that vault by
// a different user is 403.
//
// CORS. Desktop (Electron) and mobile (Expo) call cross-origin, so every response
// (auth + sync) carries CORS headers and `OPTIONS` is answered as a preflight.
// ---------------------------------------------------------------------------

export { VaultCoordinator };

/** Response headers clients must be able to read cross-origin. */
const EXPOSED_HEADERS = [HEADER_VERSION, HEADER_CONTENT_HASH, "set-auth-token"].join(", ");

/** Re-emit `response` with CORS headers derived from the request `Origin`. */
function withCors(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  const origin = request.headers.get("origin");
  // Bearer auth carries no cookies, so credentials aren't needed and reflecting
  // the origin (or `*` when absent) is safe. Vary on Origin when we reflect one.
  headers.set("access-control-allow-origin", origin ?? "*");
  if (origin !== null) headers.append("vary", "origin");
  headers.set("access-control-allow-methods", "GET,PUT,DELETE,POST,OPTIONS");
  headers.set("access-control-allow-headers", "Authorization, Content-Type, x-base-version");
  headers.set("access-control-expose-headers", EXPOSED_HEADERS);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * First-writer-wins ownership. Returns true iff `userId` may act on `vaultId`:
 * the existing owner matches, or the vault is unclaimed (then claim it). The
 * claim is racey — two first-touch requests can both find it absent — so we
 * insert with `onConflictDoNothing` and re-read to settle on the single winner.
 */
async function ownsVault(db: ReturnType<typeof createDb>, vaultId: string, userId: string) {
  const existing = await db
    .select({ userId: vaultOwner.userId })
    .from(vaultOwner)
    .where(eq(vaultOwner.vaultId, vaultId))
    .get();
  if (existing !== undefined) return existing.userId === userId;

  await db.insert(vaultOwner).values({ vaultId, userId }).onConflictDoNothing();
  const owner = await db
    .select({ userId: vaultOwner.userId })
    .from(vaultOwner)
    .where(eq(vaultOwner.vaultId, vaultId))
    .get();
  return owner !== undefined && owner.userId === userId;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight — answer before any auth/routing work.
    if (request.method === "OPTIONS") {
      return withCors(request, new Response(null, { status: 204 }));
    }

    // Better Auth surface.
    if (url.pathname.startsWith("/api/auth/")) {
      return withCors(request, await createAuth(env).handler(request));
    }

    // Sync surface.
    const match = matchRoute(request.method, url.pathname, url.search);
    if (match.kind === "unmatched") {
      return withCors(request, new Response("not found", { status: 404 }));
    }

    // Authenticate: the bearer plugin reads `Authorization: Bearer …`.
    const auth = createAuth(env);
    const authResult = await auth.api.getSession({ headers: request.headers });
    if (authResult === null) {
      return withCors(request, new Response("unauthorized", { status: 401 }));
    }

    // Authorize: the caller must own (or be the first to claim) this vault.
    const db = createDb(env.DB);
    if (!(await ownsVault(db, match.vaultId, authResult.user.id))) {
      return withCors(request, new Response("forbidden", { status: 403 }));
    }

    const id = env.VaultCoordinator.idFromName(match.vaultId);
    return withCors(request, await env.VaultCoordinator.get(id).fetch(request));
  },
} satisfies ExportedHandler<Env>;
