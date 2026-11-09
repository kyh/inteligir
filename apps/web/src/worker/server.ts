import site from "@tanstack/react-start/server-entry";
import { doorsFor } from "@repo/service/doors-for";
import type { FillJob } from "@repo/service/fill/fill-job";
import { consumeFills } from "@repo/service/fill/fill-consumer";
import type { RequestContext } from "../request-context";

// A plain ExportedHandler rather than Start's createServerEntry: Cloudflare calls fetch with the
// bindings, and a ServerEntry's (request, opts?) has nowhere to put them. cloudflare.config.ts's
// `entrypoint` must be this file, for the reason noted there. Every path is Start's: a door's server
// route hands its request to the service through the context built here, per request, since the
// doors close over this request's ExecutionContext.
const requestContext = (env: Env, ctx: ExecutionContext): RequestContext => ({
  doors: doorsFor(env, ctx),
});

// the runtime instantiates Durable Objects from the deployed entry's exports, each under the name
// cloudflare.config.ts declares it by
export { AgentThreadDO } from "@repo/service/agent/agent-thread";
export { LibraryDO } from "@repo/service/library/library-do";

export default {
  async fetch(request, env, ctx) {
    return await site.fetch(request, { context: requestContext(env, ctx) });
  },
  // the pages the cloud reads, and the ones its retries could not
  // (@repo/service/fill/fill-consumer)
  async queue(batch, env, ctx) {
    await consumeFills(batch, env, ctx);
  },
} satisfies ExportedHandler<Env, FillJob>;
