// the 0.4 client rejects a request with the response's bare JSON-RPC `error` object, not an Error,
// which any `instanceof Error` reader prints as "[object Object]"; every request goes through acpCall.

import { RequestError } from "@zed-industries/agent-client-protocol";
import { z } from "zod";
import type { HarnessDefinition } from "./harness-registry.js";

// the code ACP reserves for an agent with no usable credential (`RequestError.authRequired`).
const AUTH_REQUIRED_CODE = -32_000;

// structural, so a RequestError instance reads the same as the bare object it was rebuilt from.
const jsonRpcErrorSchema = z.object({
  code: z.number(),
  data: z.unknown().optional(),
  message: z.string(),
});

export const acpCall = async <T>(request: Promise<T>): Promise<T> => {
  try {
    return await request;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    const parsed = jsonRpcErrorSchema.safeParse(error);
    throw parsed.success
      ? new RequestError(parsed.data.code, parsed.data.message, parsed.data.data)
      : error;
  }
};

export const describeProviderError = (cause: unknown, harness?: HarnessDefinition): string => {
  const parsed = jsonRpcErrorSchema.safeParse(cause);
  if (parsed.success) {
    return parsed.data.code === AUTH_REQUIRED_CODE && harness !== undefined
      ? `${harness.displayName} is not signed in — run: ${harness.loginCommand}`
      : parsed.data.message;
  }
  return cause instanceof Error ? cause.message : String(cause);
};
