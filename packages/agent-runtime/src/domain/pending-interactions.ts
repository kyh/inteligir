// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// Trimmed to the APPROVAL family: codex raises command / file-change /
// permission-grant approvals and nothing else this deployment carries.
// bb's user_question and plugin payloads, the plan-review subject
// (claude-code only) and the server-side row schemas are not vendored —
// the pending_interactions TABLE and its wire shape live in @repo/db and
// @repo/server-contract; these schemas are the PAYLOAD contract inside a
// row's JSON `payload` / `resolution` columns.

import { z } from "zod";

export const pendingInteractionCommandActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("read"),
    command: z.string(),
    name: z.string(),
    path: z.string(),
  }),
  z.object({
    type: z.literal("listFiles"),
    command: z.string(),
    path: z.string().nullable(),
  }),
  z.object({
    type: z.literal("search"),
    command: z.string(),
    query: z.string().nullable(),
    path: z.string().nullable(),
  }),
  z.object({
    type: z.literal("unknown"),
    command: z.string(),
  }),
]);
export type PendingInteractionCommandAction = z.infer<typeof pendingInteractionCommandActionSchema>;

export const pendingInteractionNetworkPermissionsSchema = z.object({
  enabled: z.boolean().nullable(),
});

export const pendingInteractionFileSystemPermissionsSchema = z.object({
  read: z.array(z.string()),
  write: z.array(z.string()),
});

const pendingInteractionMacOsPreferencesPermissionSchema = z.enum([
  "none",
  "read_only",
  "read_write",
]);

const pendingInteractionMacOsContactsPermissionSchema = z.enum(["none", "read_only", "read_write"]);

const pendingInteractionMacOsAutomationPermissionSchema = z.union([
  z.literal("none"),
  z.literal("all"),
  z.object({
    kind: z.literal("bundle_ids"),
    bundleIds: z.array(z.string()),
  }),
]);

export const pendingInteractionMacOsPermissionsSchema = z.object({
  preferences: pendingInteractionMacOsPreferencesPermissionSchema,
  automations: pendingInteractionMacOsAutomationPermissionSchema,
  launchServices: z.boolean(),
  accessibility: z.boolean(),
  calendar: z.boolean(),
  reminders: z.boolean(),
  contacts: pendingInteractionMacOsContactsPermissionSchema,
});
export type PendingInteractionMacOsPermissions = z.infer<
  typeof pendingInteractionMacOsPermissionsSchema
>;

export const pendingInteractionRequestedPermissionProfileSchema = z.object({
  network: pendingInteractionNetworkPermissionsSchema.nullable(),
  fileSystem: pendingInteractionFileSystemPermissionsSchema.nullable(),
  macos: pendingInteractionMacOsPermissionsSchema.nullable(),
});
export type PendingInteractionRequestedPermissionProfile = z.infer<
  typeof pendingInteractionRequestedPermissionProfileSchema
>;

export const pendingInteractionGrantablePermissionProfileSchema = z
  .object({
    network: pendingInteractionNetworkPermissionsSchema.nullable(),
    fileSystem: pendingInteractionFileSystemPermissionsSchema.nullable(),
  })
  .strict();
export type PendingInteractionGrantablePermissionProfile = z.infer<
  typeof pendingInteractionGrantablePermissionProfileSchema
>;

const pendingInteractionGrantedPermissionProfileSchema =
  pendingInteractionGrantablePermissionProfileSchema;
export type PendingInteractionGrantedPermissionProfile = z.infer<
  typeof pendingInteractionGrantedPermissionProfileSchema
>;

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
  actions: z.array(pendingInteractionCommandActionSchema),
  sessionGrant: pendingInteractionGrantablePermissionProfileSchema.nullable(),
});

export const pendingInteractionFileChangeApprovalSubjectSchema = z.object({
  kind: z.literal("file_change"),
  itemId: z.string().min(1),
  writeScope: z.string().min(1).nullable(),
  sessionGrant: pendingInteractionGrantablePermissionProfileSchema.nullable(),
});

export const pendingInteractionPermissionGrantApprovalSubjectSchema = z.object({
  kind: z.literal("permission_grant"),
  itemId: z.string().min(1),
  toolName: z.string().nullable(),
  permissions: pendingInteractionGrantablePermissionProfileSchema,
});
export type PendingInteractionPermissionGrantApprovalSubject = z.infer<
  typeof pendingInteractionPermissionGrantApprovalSubjectSchema
>;

export const pendingInteractionApprovalSubjectSchema = z.discriminatedUnion("kind", [
  pendingInteractionCommandApprovalSubjectSchema,
  pendingInteractionFileChangeApprovalSubjectSchema,
  pendingInteractionPermissionGrantApprovalSubjectSchema,
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

export function isApprovalPendingInteractionPayload(
  payload: PendingInteractionPayload,
): payload is ApprovalPendingInteractionPayload {
  return payload.kind === "approval";
}

const approvalDecisionDiscriminatorError =
  "Invalid discriminator value. Expected 'allow_once' | 'allow_for_session' | 'deny'";

export const approvalPendingInteractionResolutionSchema = z.discriminatedUnion(
  "decision",
  [
    z.object({
      decision: z.literal("allow_once"),
      grantedPermissions: pendingInteractionGrantedPermissionProfileSchema.nullable(),
    }),
    z.object({
      decision: z.literal("allow_for_session"),
      grantedPermissions: pendingInteractionGrantedPermissionProfileSchema.nullable(),
    }),
    z.object({
      decision: z.literal("deny"),
    }),
  ],
  approvalDecisionDiscriminatorError,
);
export type ApprovalPendingInteractionResolution = z.infer<
  typeof approvalPendingInteractionResolutionSchema
>;

export type PendingInteractionResolution = z.infer<
  typeof approvalPendingInteractionResolutionSchema
>;

export function isApprovalPendingInteractionResolution(
  resolution: PendingInteractionResolution,
): resolution is ApprovalPendingInteractionResolution {
  return "decision" in resolution;
}

export type ApprovalResolutionParse =
  | { ok: true; resolution: ApprovalPendingInteractionResolution }
  | { ok: false; reason: string };

/**
 * THE interaction-resolution grammar, shared by the answer route's 400 gate
 * and the runtime's answer path so the two can never drift: a bare decision
 * verb ("deny", "allow_once", "allow_for_session") or the full resolution
 * JSON. Deny is always acceptable (it is what every cancel path answers
 * with); any other decision must be one the request offered. A
 * permission-grant allow with no explicit grant falls back to granting
 * exactly what the payload requested.
 */
export function parseApprovalResolution(
  raw: string,
  payload: ApprovalPendingInteractionPayload,
): ApprovalResolutionParse {
  const trimmed = raw.trim();
  let parsed: ApprovalPendingInteractionResolution;
  if (trimmed === "deny") {
    parsed = { decision: "deny" };
  } else if (trimmed === "allow_once" || trimmed === "allow_for_session") {
    parsed = { decision: trimmed, grantedPermissions: null };
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
  if (
    parsed.decision !== "deny" &&
    parsed.grantedPermissions === null &&
    payload.subject.kind === "permission_grant"
  ) {
    return {
      ok: true,
      resolution: { decision: parsed.decision, grantedPermissions: payload.subject.permissions },
    };
  }
  return { ok: true, resolution: parsed };
}

export const pendingInteractionCreateSchema = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  providerId: z.string().min(1),
  providerThreadId: z.string().min(1),
  providerRequestId: z.string().min(1),
  payload: approvalPendingInteractionPayloadSchema,
});
export type PendingInteractionCreate = z.infer<typeof pendingInteractionCreateSchema>;
