import site from "@tanstack/react-start/server-entry";
import api, { ownsPath } from "./index";

// A plain ExportedHandler rather than Start's createServerEntry: Cloudflare calls fetch with the
// bindings, and a ServerEntry's (request, opts?) has nowhere to put them. cloudflare.config.ts's
// `entrypoint` must be this file; pointing it at the @tanstack/react-start/server-entry export builds
// that entry alone and silently drops everything here (cloudflare/workers-sdk#11100).

// the runtime instantiates Durable Objects from the deployed entry's exports
export { ThreadSyncDO } from "./sync/thread-sync-do";

export default {
  async fetch(request, env) {
    return ownsPath(new URL(request.url).pathname)
      ? await api.fetch(request, env)
      : await site.fetch(request);
  },
} satisfies ExportedHandler<Env>;
