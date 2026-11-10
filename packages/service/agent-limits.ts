// What the built-in agent may spend and what Claude costs, spelled once for the configs that bind
// them (apps/web's and the suites' `cloudflare.config.ts`): data, not code. The Worker's own code
// never imports it, since the dev server cannot load a module the config also loads; it reads
// `AGENT_ALLOWANCE` and `AGENT_PRICES` from its bindings (`src/agent/agent-allowance.ts`).

// about fifty free turns a month, held first as a UTC day's two turns and a dollar of list cost,
// and the two turns an account may run at once (owner decision)
export const AGENT_ALLOWANCE = { concurrentTurns: 2, dayCents: 100, dayTurns: 2 };

// list prices in dollars a million tokens, by the model that answered: the agent's, and the ones
// Anthropic falls back to on a refusal (platform.claude.com/docs/en/about-claude/pricing); the
// allowance holds each to two decimals, so a token is a whole number of micro-cents
export const AGENT_PRICES = {
  "claude-sonnet-5": { cacheRead: 0.2, cacheWrite1h: 4, cacheWrite5m: 2.5, input: 2, output: 10 },
  "claude-sonnet-5-5": { cacheRead: 0.1, cacheWrite1h: 4, cacheWrite5m: 2.5, input: 2, output: 10 },
};
