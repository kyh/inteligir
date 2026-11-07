// `pnpm dev:web` starts this beside the local Worker: the scripted Messages API on its pinned port
// (docs/development.md), which the Worker reaches through `ANTHROPIC_FAKE_URL`
// (apps/web/.dev.vars.example).

import { serveMessagesFake } from "./serve.ts";

const PORT = 5177;

const served = await serveMessagesFake(PORT);
console.info(`the scripted Messages API answers at ${served.origin}`);
