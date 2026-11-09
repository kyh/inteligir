// What the built-in agent may spend and what Claude costs, spelled once for the configs that bind
// them (apps/web's and the suites' `cloudflare.config.ts`): data, not code. The Worker's own code
// never imports it, since the dev server cannot load a module the config also loads; it reads
// `AGENT_ALLOWANCE` and `AGENT_PRICES` from its bindings (`src/agent/agent-allowance.ts`).

// about fifty free turns a month, held first as a UTC day's two turns and a dollar of list cost,
// the fifty cents one turn may cost, and the two turns an account may run at once (owner decision)
export const AGENT_ALLOWANCE = { concurrentTurns: 2, dayCents: 100, dayTurns: 2, turnCents: 50 };

// list prices in dollars a million tokens, by the model that answered: the agent's, and the ones
// Anthropic falls back to on a refusal (platform.claude.com/docs/en/about-claude/pricing); the
// allowance holds each to two decimals, so a token is a whole number of micro-cents
export const AGENT_PRICES = {
  "claude-opus-4-8": { cacheRead: 0.5, cacheWrite1h: 10, cacheWrite5m: 6.25, input: 5, output: 25 },
  "claude-opus-5": { cacheRead: 0.5, cacheWrite1h: 10, cacheWrite5m: 6.25, input: 5, output: 25 },
  "claude-opus-5-5": { cacheRead: 0.2, cacheWrite1h: 8, cacheWrite5m: 5, input: 4, output: 20 },
};
