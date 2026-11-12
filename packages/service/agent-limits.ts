// What the built-in agent may run, spelled once for the configs that bind it (apps/web's and the
// suites' `cloudflare.config.ts`): data, not code. The Worker's own code never imports it, since the
// dev server cannot load a module the config also loads; it reads `AGENT_ALLOWANCE` from its
// bindings (`src/agent/agent-allowance.ts`).

// about fifty free turns a month, held first as a UTC day's two turns, and the two turns an account
// may run at once (owner decision); the dollars are the gateway's spend limit's alone
export const AGENT_ALLOWANCE = { concurrentTurns: 2, dayTurns: 2 };
