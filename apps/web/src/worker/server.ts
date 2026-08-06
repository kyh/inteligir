import site from "@tanstack/react-start/server-entry";
import api, { ownsPath } from "./index";

// ---------------------------------------------------------------------------
// The Worker entry: ONE script serving the marketing site and the app's API from
// ONE origin, which is what makes the two same-origin to each other.
//
// The split is by path and nothing else — `ownsPath` (declared beside the API
// route table, so the two cannot drift) sends /api/*, /v1/* and /auth/* to the
// vault-sync + Better Auth surface, and everything else to TanStack Start's SSR
// handler.
//
// The default export is a plain `ExportedHandler<Env>` rather than Start's
// `createServerEntry(...)`: Cloudflare calls it with `(request, env, ctx)` and
// the API half threads all three, while a `ServerEntry`'s `(request, opts?)`
// signature has nowhere to put the bindings. Start's own default entry is
// already a `{ fetch }`, so it composes here as-is.
//
// wrangler.jsonc's `main` must name THIS FILE by path. Pointing it at the
// `@tanstack/react-start/server-entry` package export instead builds that
// default entry alone and silently drops everything here, Durable Object
// included.
// ---------------------------------------------------------------------------

export { VaultCoordinator } from "./vault-coordinator";

export default {
  fetch(request, env, ctx) {
    return ownsPath(new URL(request.url).pathname)
      ? api.fetch(request, env, ctx)
      : site.fetch(request);
  },
} satisfies ExportedHandler<Env>;
