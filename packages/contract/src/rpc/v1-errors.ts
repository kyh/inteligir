import { COMMON_ERROR_STATUS_MAP, ORPCError } from "@orpc/client";
import { error, oc } from "@orpc/contract";
import { z } from "zod";

import { editRefusalSchema, shaSchema } from "../library/library-wire";

export const isOrpcError = (cause: unknown): cause is ORPCError<string, unknown> =>
  cause instanceof ORPCError;

export const ClientOutdatedError = error("CLIENT_OUTDATED", {
  message: "This version of the app is too old. Update it to keep going.",
});

export const retryAfterSchema = z.object({ retryAfterSeconds: z.number().int().positive() });

export const TooManyRequestsError = error("TOO_MANY_REQUESTS", {
  data: retryAfterSchema.optional(),
  message: "Too many requests. Try again in a minute.",
});

export const UnauthorizedError = error("UNAUTHORIZED", {
  message: "You're signed out. Sign in again.",
});

export const AccountGoneError = error("GONE", { message: "This account was deleted." });

export const ConflictError = error("CONFLICT", { message: "This changed since it was read." });

export const NotFoundError = error("NOT_FOUND", { message: "That isn't in the library." });

export const BlobMissingError = error("BLOB_MISSING", {
  data: z.object({ shas: z.array(shaSchema).min(1) }),
  message: "A file this names hasn't been uploaded yet.",
});

export const BlobMismatchError = error("BAD_REQUEST", {
  message: "This file changed on this device before it was sent.",
});

export const PayloadTooLargeError = error("PAYLOAD_TOO_LARGE", {
  message: "This is too large to keep in one item.",
});

export const QuotaError = error("QUOTA", {
  data: z.object({ bytesCap: z.number().int().positive(), bytesUsed: z.number().int().min(0) }),
  message: "Your library is full.",
});

export const EditRefusedError = error("UNPROCESSABLE_CONTENT", {
  data: editRefusalSchema,
  message: "That edit doesn't match the item's text.",
});

export const AgentBudgetError = error("AGENT_BUDGET", {
  data: z.object({ resetsAt: z.number().int().nonnegative() }),
  message: "The agent has used today's allowance.",
});

export const AgentUnavailableError = error("SERVICE_UNAVAILABLE", {
  data: z.object({ resetsAt: z.number().int().nonnegative() }).optional(),
  message: "The agent can't be reached right now.",
});

export const InvalidCredentialsError = error("INVALID_CREDENTIALS", {
  message: "That email and password don't match an account.",
});

export const signedBase = oc.errors({
  [AccountGoneError.code]: AccountGoneError,
  [ClientOutdatedError.code]: ClientOutdatedError,
  [TooManyRequestsError.code]: TooManyRequestsError,
  [UnauthorizedError.code]: UnauthorizedError,
});

export const V1_CUSTOM_ERROR_STATUS = {
  [AgentBudgetError.code]: 429,
  [BlobMissingError.code]: 409,
  [ClientOutdatedError.code]: 426,
  [InvalidCredentialsError.code]: 401,
  [QuotaError.code]: 507,
} as const;

export const V1_ERROR_STATUS_MAP = {
  ...COMMON_ERROR_STATUS_MAP,
  ...V1_CUSTOM_ERROR_STATUS,
} satisfies Record<string, number>;
