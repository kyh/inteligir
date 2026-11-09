// the suites' Worker (cloudflare.config.ts's entrypoint): the deployed entry's Durable Objects and
// its doors, without the site, whose SSR needs the virtual modules only Start's vite plugin supplies
import { answerDoor } from "../doors";
import { consumeFills } from "../fill/fill-consumer";
import type { FillJob } from "../fill/fill-job";

// the runtime instantiates each from the entry's exports, by the name the config declares it under
export { AgentThreadDO } from "../agent/agent-thread";
export { LibraryDO } from "../library/library-do";

export default { fetch: answerDoor, queue: consumeFills } satisfies ExportedHandler<Env, FillJob>;
