import site from "@tanstack/react-start/server-entry";
import api, { ownsPath } from "./index";

// A plain ExportedHandler rather than Start's createServerEntry: Cloudflare calls fetch with the
// bindings, and a ServerEntry's (request, opts?) has nowhere to put them. wrangler.jsonc's `main`
// must name this file by path; pointing it at the @tanstack/react-start/server-entry export builds
// that entry alone and silently drops everything here (cloudflare/workers-sdk#11100).

// the runtime instantiates Durable Objects from the deployed entry's exports
export { ThreadSyncDO } from "./sync/thread-sync-do";
export { RepoCell, Registry } from "durable-git";

export default {
  fetch(request, env, ctx) {
    return ownsPath(new URL(request.url).pathname)
      ? api.fetch(request, env, ctx)
      : site.fetch(request);
  },
} satisfies ExportedHandler<Env>;
