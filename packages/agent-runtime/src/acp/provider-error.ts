import type { PromptResponse } from "@agentclientprotocol/sdk";
import type { ProviderFailure } from "@repo/domain/provider-event";
import { z } from "zod";

// the code ACP reserves for an agent with no usable credential (`RequestError.authRequired`).
const AUTH_REQUIRED_CODE = -32_000;

// structural, so a RequestError reads the same as a JSON-RPC error object arriving any other way.
const jsonRpcErrorSchema = z.object({
  code: z.number(),
  data: z.unknown().optional(),
  message: z.string(),
});

// what claude-agent-acp attaches to a refused prompt: the Claude SDK's assistant error, or one of
// its own.
const errorKindSchema = z.looseObject({ errorKind: z.string() });

const CLAUDE_ERROR_KINDS = new Map<string, ProviderFailure>([
  ["account_on_hold", "usage-limit"],
  ["authentication_failed", "auth"],
  ["billing_error", "usage-limit"],
  ["max_output_tokens", "context"],
  ["oauth_org_not_allowed", "auth"],
  ["overloaded", "overloaded"],
  ["rate_limit", "usage-limit"],
]);

// claude's plan limit can arrive with no errorKind, as the adapter's own text after the sdk's
// "Internal error: "; these are the openings the adapter itself tests for (the sdk's
// USAGE_LIMIT_ERROR_PREFIXES), the ones a plan's limit says.
const USAGE_LIMIT_OPENINGS = [
  "You've hit your",
  "You've reached your",
  "You're out of usage credits",
  "You're out of extra usage",
  "Your org is out of usage",
] as const;

const INTERNAL_ERROR_PREFIX = "Internal error: ";

// codex-acp's typed session failures, the JetBrains AIR extension, as a client declares them on
// initialize (a harness row's `typedFailures`).
export const TYPED_FAILURES_META = {
  jetbrains: { air: { capabilities: ["sessionFailure"], version: 1 } },
} as const;

// a declared failure, as it rides the prompt's answer. a warning is one the turn got past.
const sessionFailureMetaSchema = z.object({
  jetbrains: z.object({
    air: z.object({
      sessionFailure: z.object({
        actions: z.array(z.string()),
        category: z.string(),
        severity: z.literal("error"),
        title: z.string(),
      }),
    }),
  }),
});

// a limit only a new session clears is the context's (codex's contextWindowExceeded and
// sessionBudgetExceeded), any other the plan's (usageLimitExceeded, rateLimitExceeded, a 429).
// `service` is codex's class for an overload and for every error it cannot place alike, so it
// says no more than other.
const typedFailureClass = (category: string, actions: readonly string[]): ProviderFailure => {
  switch (category) {
    case "access": {
      return "auth";
    }
    case "limit": {
      return actions.includes("new_session") ? "context" : "usage-limit";
    }
    default: {
      return "other";
    }
  }
};

const saysUsageLimit = (message: string): boolean => {
  const said = message.startsWith(INTERNAL_ERROR_PREFIX)
    ? message.slice(INTERNAL_ERROR_PREFIX.length)
    : message;
  return USAGE_LIMIT_OPENINGS.some((opening) => said.startsWith(opening));
};

// the host words what a person reads from the class; the adapter's own words are its fallback.
interface ProviderErrorReading {
  adapterMessage: string;
  failure: ProviderFailure;
}

// a refused prompt or session open, or a dead adapter, read into the class a settle decides the
// queue by.
export const readProviderError = (cause: unknown): ProviderErrorReading => {
  const parsed = jsonRpcErrorSchema.safeParse(cause);
  if (!parsed.success) {
    return {
      adapterMessage: cause instanceof Error ? cause.message : String(cause),
      failure: "other",
    };
  }
  const { code, data, message } = parsed.data;
  const kind = errorKindSchema.safeParse(data);
  const kindFailure = kind.success ? CLAUDE_ERROR_KINDS.get(kind.data.errorKind) : undefined;
  const failure =
    code === AUTH_REQUIRED_CODE
      ? "auth"
      : (kindFailure ?? (saysUsageLimit(message) ? "usage-limit" : "other"));
  return { adapterMessage: message, failure };
};

// a turn the adapter answered with a typed failure, which fails it whatever its stop reason; null
// is a turn that ended without one.
export const readSessionFailure = (meta: PromptResponse["_meta"]): ProviderErrorReading | null => {
  const parsed = sessionFailureMetaSchema.safeParse(meta);
  if (!parsed.success) {
    return null;
  }
  const { actions, category, title } = parsed.data.jetbrains.air.sessionFailure;
  return { adapterMessage: title, failure: typedFailureClass(category, actions) };
};

export const describeProviderError = (cause: unknown): string =>
  readProviderError(cause).adapterMessage;
