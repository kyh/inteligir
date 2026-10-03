import type { ProviderFailure } from "@repo/domain/provider-event";
import { z } from "zod";
import type { HarnessDefinition } from "./harness-registry.js";

// the code ACP reserves for an agent with no usable credential (`RequestError.authRequired`).
const AUTH_REQUIRED_CODE = -32_000;

// structural, so a RequestError reads the same as a JSON-RPC error object arriving any other way.
const jsonRpcErrorSchema = z.object({
  code: z.number(),
  data: z.unknown().optional(),
  message: z.string(),
});

// what each adapter attaches to a refused prompt: claude-agent-acp an `errorKind` (the Claude SDK's
// assistant error, or one of its own), codex-acp the app server's `codexErrorInfo`, a name or an
// object keyed by one. read field by field, so a shape either adapter changes costs the class only.
const errorKindSchema = z.looseObject({ errorKind: z.string() });
const codexErrorNameSchema = z.looseObject({ codexErrorInfo: z.string() });
const codexErrorStatusSchema = z.looseObject({
  codexErrorInfo: z.record(z.string(), z.looseObject({ httpStatusCode: z.number() })),
});

const CLAUDE_ERROR_KINDS = new Map<string, ProviderFailure>([
  ["account_on_hold", "usage-limit"],
  ["authentication_failed", "auth"],
  ["billing_error", "usage-limit"],
  ["max_output_tokens", "context"],
  ["oauth_org_not_allowed", "auth"],
  ["overloaded", "overloaded"],
  ["rate_limit", "usage-limit"],
]);

const CODEX_ERROR_NAMES = new Map<string, ProviderFailure>([
  ["contextWindowExceeded", "context"],
  ["rateLimitExceeded", "usage-limit"],
  ["serverOverloaded", "overloaded"],
  ["unauthorized", "auth"],
  ["usageLimitExceeded", "usage-limit"],
]);

const HTTP_STATUS_FAILURES = new Map<number, ProviderFailure>([
  [401, "auth"],
  [429, "usage-limit"],
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

// what the adapter attached, each field read on its own.
interface AdapterErrorData {
  errorKind: string | null;
  codexName: string | null;
  httpStatuses: number[];
}

const failureOfData = (data: AdapterErrorData): ProviderFailure | null => {
  if (data.errorKind !== null) {
    return CLAUDE_ERROR_KINDS.get(data.errorKind) ?? null;
  }
  if (data.codexName !== null) {
    return CODEX_ERROR_NAMES.get(data.codexName) ?? null;
  }
  for (const status of data.httpStatuses) {
    const failure = HTTP_STATUS_FAILURES.get(status);
    if (failure !== undefined) {
      return failure;
    }
  }
  return null;
};

const saysUsageLimit = (message: string): boolean => {
  const said = message.startsWith(INTERNAL_ERROR_PREFIX)
    ? message.slice(INTERNAL_ERROR_PREFIX.length)
    : message;
  return USAGE_LIMIT_OPENINGS.some((opening) => said.startsWith(opening));
};

interface ProviderErrorReading {
  message: string;
  failure: ProviderFailure;
}

const sentenceFor = (
  failure: ProviderFailure,
  adapterMessage: string,
  harness: HarnessDefinition | undefined,
): string => {
  if (harness === undefined) {
    return adapterMessage;
  }
  switch (failure) {
    case "auth": {
      return `${harness.displayName} is signed out on this Mac.`;
    }
    case "usage-limit": {
      return `${harness.displayName} says you've reached your plan's usage limit. Your queued messages will wait until you send again.`;
    }
    case "overloaded":
    case "context":
    case "other": {
      return adapterMessage;
    }
    // no default
  }
};

// a refused prompt as the panel words it, with the class a settle decides the queue by.
export const readProviderError = (
  cause: unknown,
  harness?: HarnessDefinition,
): ProviderErrorReading => {
  const parsed = jsonRpcErrorSchema.safeParse(cause);
  if (!parsed.success) {
    return { failure: "other", message: cause instanceof Error ? cause.message : String(cause) };
  }
  const { code, data, message } = parsed.data;
  const kind = errorKindSchema.safeParse(data);
  const name = codexErrorNameSchema.safeParse(data);
  const status = codexErrorStatusSchema.safeParse(data);
  const adapterData: AdapterErrorData = {
    codexName: name.success ? name.data.codexErrorInfo : null,
    errorKind: kind.success ? kind.data.errorKind : null,
    httpStatuses: status.success
      ? Object.values(status.data.codexErrorInfo).map((details) => details.httpStatusCode)
      : [],
  };
  const failure =
    code === AUTH_REQUIRED_CODE
      ? "auth"
      : (failureOfData(adapterData) ?? (saysUsageLimit(message) ? "usage-limit" : "other"));
  return { failure, message: sentenceFor(failure, message, harness) };
};

export const describeProviderError = (cause: unknown, harness?: HarnessDefinition): string =>
  readProviderError(cause, harness).message;
