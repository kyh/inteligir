// Every refusal `/v1` answers, declared once with oRPC's `error()` and registered on each row that
// can raise it, so a client narrows a refusal by its code and reads its data typed. oRPC's own
// codes stand wherever they mean the same thing; the codes below them are this wire's own. An
// error's message and data reach the client and, through the connector, the model, so neither
// holds anything a caller may not see.

import { COMMON_ERROR_STATUS_MAP } from "@orpc/client";
import { error, oc } from "@orpc/contract";
import { z } from "zod";

import { conflictCurrentSchema, editRefusalSchema, shaSchema } from "./library/library-wire";

// ---- what any request may meet before its procedure runs ----

// the build is below the Worker's floor: the credential stands, and only an update moves past it
export const ClientOutdatedError = error("CLIENT_OUTDATED", {
  message: "This version of the app is too old. Update it to keep going.",
});

export const TooManyRequestsError = error("TOO_MANY_REQUESTS", {
  message: "Too many requests. Try again in a minute.",
});

// the credential is revoked or unknown; one answer for both, since "revoked" tells a thief it
// once worked
export const UnauthorizedError = error("UNAUTHORIZED", {
  message: "You're signed out. Sign in again.",
});

// the account is deleted: 410, not 401, since a client told "unauthorized" retries the credential
export const AccountGoneError = error("GONE", { message: "This account was deleted." });

// ---- the library's ----

// what a write's bases met instead: each block, place, field, highlight or folder as it is now,
// so the device merges against it and resends
export const ConflictError = error("CONFLICT", {
  data: z.object({ current: z.array(conflictCurrentSchema).min(1) }),
  message: "This changed since it was read.",
});

export const NotFoundError = error("NOT_FOUND", { message: "That isn't in the library." });

// a write names a file the library does not hold yet: the device uploads these and resends
export const BlobMissingError = error("BLOB_MISSING", {
  data: z.object({ shas: z.array(shaSchema).min(1) }),
  message: "A file this names hasn't been uploaded yet.",
});

// a block, an item's text or a field past its cap
export const PayloadTooLargeError = error("PAYLOAD_TOO_LARGE", {
  message: "This is too large to keep in one item.",
});

export const QuotaError = error("QUOTA", {
  data: z.object({ bytesCap: z.number().int().positive(), bytesUsed: z.number().int().min(0) }),
  message: "Your library is full.",
});

// an `old_text` that stands nowhere or more than once, or an edit the item's sections cannot take
export const EditRefusedError = error("UNPROCESSABLE_CONTENT", {
  data: editRefusalSchema,
  message: "That edit doesn't match the item's text.",
});

// an undo names a change set already undone: undoing it again would redo it
export const AlreadyUndoneError = error("ALREADY_UNDONE", {
  data: z.object({ changeSetId: z.string().min(1), undoneBy: z.string().min(1) }),
  message: "That change was already undone.",
});

// ---- the built-in agent's ----

export const AgentBudgetError = error("AGENT_BUDGET", {
  data: z.object({ resetsAt: z.number().int().nonnegative() }),
  message: "The agent has used today's allowance.",
});

// the built-in agent is off, or Anthropic cannot be reached; no turn starts and none is charged
export const AgentUnavailableError = error("SERVICE_UNAVAILABLE", {
  message: "The agent can't be reached right now.",
});

// ---- the account's ----

export const InvalidCredentialsError = error("INVALID_CREDENTIALS", {
  message: "That email and password don't match an account.",
});

export const DeviceLimitError = error("DEVICE_LIMIT", {
  message: "This account is signed in on too many devices. Sign one out first.",
});

export const AccountExistsError = error("ACCOUNT_EXISTS", {
  message: "An account with that email already exists.",
});

// one sentence for "no such code" and "already used", so a caller learns only that it will not work
export const InviteRefusedError = error("FORBIDDEN", {
  message: "That invite code isn't valid. Check it and try again.",
});

// what every row is built on: an unauthenticated call (signing in or up) meets the floor and the
// rate limits, and a signed one the credential's own refusals besides
export const publicBase = oc.errors({
  [ClientOutdatedError.code]: ClientOutdatedError,
  [TooManyRequestsError.code]: TooManyRequestsError,
});

export const signedBase = publicBase.errors({
  [AccountGoneError.code]: AccountGoneError,
  [UnauthorizedError.code]: UnauthorizedError,
});

// the codes oRPC does not know; one with no status here would default to 400 unnoticed
export const V1_CUSTOM_ERROR_STATUS = {
  [AccountExistsError.code]: 409,
  [AgentBudgetError.code]: 429,
  [AlreadyUndoneError.code]: 409,
  [BlobMissingError.code]: 409,
  [ClientOutdatedError.code]: 426,
  [DeviceLimitError.code]: 409,
  [InvalidCredentialsError.code]: 401,
  // 507 as the hosted vault's full answered: the library cannot store this, which no retry fixes
  [QuotaError.code]: 507,
} as const;

// every RPCHandler on `/v1` maps codes to statuses with this, the Worker's and the cell's alike
export const V1_ERROR_STATUS_MAP = {
  ...COMMON_ERROR_STATUS_MAP,
  ...V1_CUSTOM_ERROR_STATUS,
} satisfies Record<string, number>;
