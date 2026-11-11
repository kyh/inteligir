// the suites' Worker (cloudflare.config.ts's entrypoint): the deployed entry's Durable Objects and
// its doors, each reached by the path table apps/web's Start routes are held to, without the site,
// whose SSR needs the virtual modules only Start's vite plugin supplies
import { doorAt } from "../door-routes";
import { doorsFor } from "../doors";
import { consumeFills } from "../fill/fill-consumer";
import type { FillJob } from "../fill/fill-job";

// the runtime instantiates each from the entry's exports, by the name the config declares it under
export { AgentThreadDO } from "../agent/agent-thread";
export { LibraryDO } from "../library/library-do";
export { NoteDO } from "../note/note-do";

export default {
  async fetch(request, env, ctx) {
    const door = doorAt(new URL(request.url).pathname);
    // what apps/web/src/routes/api/$.ts and v1/$.ts answer under the doors' prefixes
    return door === undefined
      ? new Response("not found", { status: 404 })
      : await doorsFor(env, ctx)[door](request);
  },
  queue: consumeFills,
} satisfies ExportedHandler<Env, FillJob>;
