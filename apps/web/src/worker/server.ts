import site from "@tanstack/react-start/server-entry";
import api, { ownsPath } from "./index";

// ---------------------------------------------------------------------------
// The Worker entry: ONE script serving the marketing site and the auth API from
// ONE origin, which is what makes the two same-origin to each other.
//
// The split is by path and nothing else — `ownsPath` (declared beside the API
// route table, so the two cannot drift) sends /api/*, /v1/* and /auth/* to the
// Better Auth surface, and everything else to TanStack Start's SSR handler.
//
// The default export is a plain `ExportedHandler<Env>` rather than Start's
// `createServerEntry(...)`: Cloudflare calls it with the bindings, and a
// `ServerEntry`'s `(request, opts?)` signature has nowhere to put them. Start's
// own default entry is already a `{ fetch }`, so it composes here as-is.
//
// wrangler.jsonc's `main` must name THIS FILE by path. Pointing it at the
// `@tanstack/react-start/server-entry` package export instead builds that
// default entry alone and silently drops everything here
// (cloudflare/workers-sdk#11100).
// ---------------------------------------------------------------------------

export default {
  fetch(request, env) {
    return ownsPath(new URL(request.url).pathname) ? api.fetch(request, env) : site.fetch(request);
  },
} satisfies ExportedHandler<Env>;
