import site from "@tanstack/react-start/server-entry";
import type { FillJob } from "@repo/service/fill/fill-job";
import { consumeFills } from "@repo/service/fill/fill-consumer";
import { answerDoor, ownsPath } from "@repo/service/doors";

// A plain ExportedHandler rather than Start's createServerEntry: Cloudflare calls fetch with the
// bindings, and a ServerEntry's (request, opts?) has nowhere to put them. cloudflare.config.ts's
// `entrypoint` must be this file, for the reason noted there.

// the runtime instantiates Durable Objects from the deployed entry's exports, each under the name
// cloudflare.config.ts declares it by
export { AgentThreadDO } from "@repo/service/agent/agent-thread";
export { LibraryDO } from "@repo/service/library/library-do";

export default {
  async fetch(request, env, ctx) {
    return ownsPath(new URL(request.url).pathname)
      ? await answerDoor(request, env, ctx)
      : await site.fetch(request);
  },
  // the pages the cloud reads, and the ones its retries could not
  // (@repo/service/fill/fill-consumer)
  async queue(batch, env, ctx) {
    await consumeFills(batch, env, ctx);
  },
} satisfies ExportedHandler<Env, FillJob>;
