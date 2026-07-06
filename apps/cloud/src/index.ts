import { HEADER_AUTHORIZATION, parseBearer } from "@repo/core/sync/wire";
import { authorize } from "./auth";
import { matchRoute } from "./route";
import { VaultCoordinator } from "./vault-coordinator";

// ---------------------------------------------------------------------------
// Worker entry for the vault-sync backend.
//
// Responsibilities: (1) match the request against the `@repo/core/sync/wire`
// routes to recover the `vaultId`; (2) authenticate (bearer token -> vault
// ownership) — a transport-level concern OUTSIDE the sync ADTs, hence a 401 on
// failure; (3) forward the request to the per-vault `VaultCoordinator` Durable
// Object (`idFromName(vaultId)`), which owns the manifest + implements the
// SyncPort semantics. The DO re-parses the route to dispatch.
// ---------------------------------------------------------------------------

export { VaultCoordinator };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = matchRoute(request.method, url.pathname, url.search);
    if (match.kind === "unmatched") {
      return new Response("not found", { status: 404 });
    }

    // Auth seam — replace `authorize` with a real check (see ./auth.ts).
    const token = parseBearer(request.headers.get(HEADER_AUTHORIZATION));
    if (token === null || !(await authorize(token, match.vaultId))) {
      return new Response("unauthorized", { status: 401 });
    }

    const id = env.VaultCoordinator.idFromName(match.vaultId);
    return env.VaultCoordinator.get(id).fetch(request);
  },
} satisfies ExportedHandler<Env>;
