import { z } from "zod";
import type { HarnessDefinition } from "./harness-registry.js";

// the code ACP reserves for an agent with no usable credential (`RequestError.authRequired`).
const AUTH_REQUIRED_CODE = -32_000;

// structural, so a RequestError reads the same as a JSON-RPC error object arriving any other way.
const jsonRpcErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
});

export const describeProviderError = (cause: unknown, harness?: HarnessDefinition): string => {
  const parsed = jsonRpcErrorSchema.safeParse(cause);
  if (parsed.success) {
    return parsed.data.code === AUTH_REQUIRED_CODE && harness !== undefined
      ? `${harness.displayName} is not signed in — run: ${harness.loginCommand}`
      : parsed.data.message;
  }
  return cause instanceof Error ? cause.message : String(cause);
};
