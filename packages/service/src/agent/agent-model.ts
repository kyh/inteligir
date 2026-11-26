import type { Usage } from "eve/events";

export const AGENT_MODEL_ID = "anthropic/claude-sonnet-5.5";

type Json = string | number | boolean | null | Json[] | GatewayOptions;

interface GatewayOptions {
  [key: string]: Json;
}

export const agentGatewayOptions = (key: string | null) => {
  const options: GatewayOptions = { caching: "auto", only: ["anthropic"] };

  if (key !== null) {
    options.byok = { anthropic: [{ apiKey: key }] };
  }

  return options;
};

export const EVE_SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000;

const MICRO_USD_PER_TOKEN = { cacheRead: 0.1, cacheWrite: 2.5, input: 2, output: 10 } as const;

export const WEB_SEARCH_MICRO_USD = 10_000;

export const costMicroUsdOf = ({
  cacheReadTokens,
  cacheWriteTokens,
  inputTokens,
  outputTokens,
}: Usage) =>
  Math.ceil(
    Math.max(0, inputTokens - cacheReadTokens - cacheWriteTokens) * MICRO_USD_PER_TOKEN.input +
      cacheWriteTokens * MICRO_USD_PER_TOKEN.cacheWrite +
      cacheReadTokens * MICRO_USD_PER_TOKEN.cacheRead +
      outputTokens * MICRO_USD_PER_TOKEN.output,
  );
