// The built-in agent's one model for everyone, through AI Gateway, and what its calls cost. The
// gateway runs Anthropic on the team's own key, so eve reports no cost for a call, and the day's
// ceilings (`./agent-limits`) price its tokens as Anthropic bills them.

import type { Usage } from "eve/events";

export const AGENT_MODEL_ID = "anthropic/claude-sonnet-5.5";

// millionths of a dollar a token: Sonnet 5.5's $2 a million in and $10 out, a cache write at $2.50
// and a cache read at 10 cents
const MICRO_USD_PER_TOKEN = { cacheRead: 0.1, cacheWrite: 2.5, input: 2, output: 10 } as const;

// a native web search, billed apart from the tokens of the call that asked for it
export const WEB_SEARCH_MICRO_USD = 10_000;

// eve counts cache reads and writes inside `inputTokens`
export const costMicroUsdOf = ({
  cacheReadTokens,
  cacheWriteTokens,
  inputTokens,
  outputTokens,
}: Usage): number =>
  Math.ceil(
    Math.max(0, inputTokens - cacheReadTokens - cacheWriteTokens) * MICRO_USD_PER_TOKEN.input +
      cacheWriteTokens * MICRO_USD_PER_TOKEN.cacheWrite +
      cacheReadTokens * MICRO_USD_PER_TOKEN.cacheRead +
      outputTokens * MICRO_USD_PER_TOKEN.output,
  );
