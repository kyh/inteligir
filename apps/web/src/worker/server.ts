import site from "@tanstack/react-start/server-entry";
import { signedInFor } from "@repo/service/auth/signed-in";
import { serviceFor } from "@repo/service/doors";
import type { FillJob } from "@repo/service/fill/fill-job";
import { consumeFills } from "@repo/service/fill/fill-consumer";
import type { RequestContext } from "../request-context";

// A plain ExportedHandler rather than Start's createServerEntry: Cloudflare calls fetch with the
// bindings, and a ServerEntry's (request, opts?) has nowhere to put them. cloudflare.config.ts's
// `entrypoint` must be this file, for the reason noted there. Every path is Start's: a mount hands
// its request to the service, and a page's guard asks it who is signed in, through the context
// built here, per request, since the service closes over this request's ExecutionContext.
const requestContext = (request: Request, env: Env, ctx: ExecutionContext): RequestContext => ({
  service: serviceFor(env, ctx),
  signedIn: signedInFor(env, ctx, request),
});

// the runtime instantiates Durable Objects from the deployed entry's exports, each under the name
// cloudflare.config.ts declares it by
export { AgentThreadDO } from "@repo/service/agent/agent-thread";
export { LibraryDO } from "@repo/service/library/library-do";
export { NoteDO } from "@repo/service/note/note-do";

export default {
  async fetch(request, env, ctx) {
    return await site.fetch(request, { context: requestContext(request, env, ctx) });
  },
  // the pages the cloud reads, and the ones its retries could not
  // (@repo/service/fill/fill-consumer)
  async queue(batch, env, ctx) {
    await consumeFills(batch, env, ctx);
  },
} satisfies ExportedHandler<Env, FillJob>;
