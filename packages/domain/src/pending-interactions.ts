// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// Trimmed to the APPROVAL family, and inside it to the two subjects an ACP
// permission request can be about: a COMMAND or a FILE CHANGE. bb's
// user_question and plugin payloads, the plan-review subject (claude-code
// only) and the server-side row schemas are not vendored — the
// pending_interactions TABLE and its wire shape live in @repo/db and
// @repo/api/local; these schemas are the PAYLOAD contract inside a
// row's JSON `payload` / `resolution` columns.
//
// Provider-neutral by construction: the adapter that RAISES an approval spawns
// processes, and this grammar is what the store, the wire contract, the CLI
// and a React card all read — so it sits in the domain, below all of them.

import { z } from "zod";

export const pendingInteractionApprovalDecisionSchema = z.enum([
  "allow_once",
  "allow_for_session",
  "deny",
]);
export type PendingInteractionApprovalDecision = z.infer<
  typeof pendingInteractionApprovalDecisionSchema
>;

export const pendingInteractionCommandApprovalSubjectSchema = z.object({
  kind: z.literal("command"),
  itemId: z.string().min(1),
  command: z.string().min(1),
  cwd: z.string().nullable(),
});

export const pendingInteractionFileChangeApprovalSubjectSchema = z.object({
  kind: z.literal("file_change"),
  itemId: z.string().min(1),
  writeScope: z.string().min(1).nullable(),
});

export const pendingInteractionApprovalSubjectSchema = z.discriminatedUnion("kind", [
  pendingInteractionCommandApprovalSubjectSchema,
  pendingInteractionFileChangeApprovalSubjectSchema,
]);
export type PendingInteractionApprovalSubject = z.infer<
  typeof pendingInteractionApprovalSubjectSchema
>;

export const approvalPendingInteractionPayloadSchema = z.object({
  kind: z.literal("approval"),
  subject: pendingInteractionApprovalSubjectSchema,
  reason: z.string().nullable(),
  availableDecisions: z.array(pendingInteractionApprovalDecisionSchema).min(1),
});
export type ApprovalPendingInteractionPayload = z.infer<
  typeof approvalPendingInteractionPayloadSchema
>;

export type PendingInteractionPayload = z.infer<typeof approvalPendingInteractionPayloadSchema>;

export const approvalPendingInteractionResolutionSchema = z.object({
  decision: pendingInteractionApprovalDecisionSchema,
});
export type ApprovalPendingInteractionResolution = z.infer<
  typeof approvalPendingInteractionResolutionSchema
>;

export type PendingInteractionResolution = z.infer<
  typeof approvalPendingInteractionResolutionSchema
>;

export type ApprovalResolutionParse =
  | { ok: true; resolution: ApprovalPendingInteractionResolution }
  | { ok: false; reason: string };

/**
 * THE interaction-resolution grammar, shared by the answer route's 400 gate
 * and the runtime's answer path so the two can never drift: a bare decision
 * verb ("deny", "allow_once", "allow_for_session") or the full resolution
 * JSON. Deny is always acceptable (it is what every cancel path answers
 * with); any other decision must be one the request offered.
 */
export function parseApprovalResolution(
  raw: string,
  payload: ApprovalPendingInteractionPayload,
): ApprovalResolutionParse {
  const trimmed = raw.trim();
  let parsed: ApprovalPendingInteractionResolution;
  if (trimmed === "deny" || trimmed === "allow_once" || trimmed === "allow_for_session") {
    parsed = { decision: trimmed };
  } else {
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch {
      return { ok: false, reason: "The resolution names no known decision" };
    }
    const result = approvalPendingInteractionResolutionSchema.safeParse(json);
    if (!result.success) {
      return {
        ok: false,
        reason: `The resolution does not match the approval grammar: ${
          result.error.issues[0]?.message ?? "invalid shape"
        }`,
      };
    }
    parsed = result.data;
  }
  if (parsed.decision !== "deny" && !payload.availableDecisions.includes(parsed.decision)) {
    return {
      ok: false,
      reason: `The request offers ${payload.availableDecisions.join(", ")}; "${parsed.decision}" is not among them`,
    };
  }
  return { ok: true, resolution: parsed };
}

/**
 * What a provider adapter hands the host when a request needs answering. An
 * interface rather than a schema: it is constructed and consumed inside one
 * program and never serialized — only `payload` crosses a boundary, into the
 * row's JSON column, and it is parsed on the way back out.
 */
export interface PendingInteractionCreate {
  threadId: string;
  turnId: string;
  providerId: string;
  providerThreadId: string;
  providerRequestId: string;
  payload: ApprovalPendingInteractionPayload;
}
