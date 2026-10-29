// `pnpm dev:web` starts this beside the local Worker: the fake Managed Agents API on its pinned
// port (docs/development.md), which the Worker reaches through `MANAGED_AGENTS_FAKE_URL`
// (apps/web/.dev.vars.example), its sessions calling the Worker's own connector.

import { serveFakeManagedAgents } from "./serve.ts";

const PORT = 5177;

const served = await serveFakeManagedAgents({ port: PORT });
console.info(`the fake Managed Agents API answers at ${served.origin}`);
