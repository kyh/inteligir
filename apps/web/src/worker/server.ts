import site from "@tanstack/react-start/server-entry";
import type { FillJob } from "./fill/fill-job";
import { consumeFills } from "./fill/fill-consumer";
import api, { ownsPath } from "./index";

// A plain ExportedHandler rather than Start's createServerEntry: Cloudflare calls fetch with the
// bindings, and a ServerEntry's (request, opts?) has nowhere to put them. cloudflare.config.ts's
// `entrypoint` must be this file, for the reason noted there.

// the runtime instantiates Durable Objects from the deployed entry's exports, each under the name
// cloudflare.config.ts declares it by
export { LibraryDO } from "./library/library-do";
export { RepoCell, Registry } from "durable-git";

export default {
  async fetch(request, env, ctx) {
    return ownsPath(new URL(request.url).pathname)
      ? await api.fetch(request, env, ctx)
      : await site.fetch(request);
  },
  // the pages the cloud reads, and the ones its retries could not (./fill/fill-consumer.ts)
  async queue(batch, env, ctx) {
    await consumeFills(batch, env, ctx);
  },
} satisfies ExportedHandler<Env, FillJob>;
