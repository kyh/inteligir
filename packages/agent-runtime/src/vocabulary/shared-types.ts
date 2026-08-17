// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// Trimmed to what the codex adapter consumes: the reasoning ladder, the
// runtime permission policy, the instruction mode and the per-thread
// execution options. bb's serviceTier / claude-code / workflows / memory /
// subagents knobs are not carried — see PROVENANCE.md.

import { z } from "zod";

/**
 * Order is load-bearing upstream (model-switch reconciliation ranks by
 * index); kept whole so a re-vendor of that logic diffs cleanly.
 */
export const reasoningLevelValues = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "ultracode",
  "max",
  "ultra",
] as const;
export const reasoningLevelSchema = z.enum(reasoningLevelValues);
export type ReasoningLevel = z.infer<typeof reasoningLevelSchema>;

/**
 * Controls how a provider incorporates server-owned instructions into its
 * system prompt: `append` keeps the provider's preset prompt, `replace` uses
 * the instructions as the whole prompt.
 */
export const instructionModeValues = ["append", "replace"] as const;
export const instructionModeSchema = z.enum(instructionModeValues);
export type InstructionMode = z.infer<typeof instructionModeSchema>;

export const permissionModeValues = ["accept-edits", "auto", "full"] as const;
export const permissionModeSchema = z.enum(permissionModeValues);
export type PermissionMode = z.infer<typeof permissionModeSchema>;

export const permissionEscalationValues = ["ask", "deny"] as const;
export const permissionEscalationSchema = z.enum(permissionEscalationValues);
export type PermissionEscalation = z.infer<typeof permissionEscalationSchema>;

export const approvalReviewerValues = ["user", "automatic"] as const;
export const approvalReviewerSchema = z.enum(approvalReviewerValues);
export type ApprovalReviewer = z.infer<typeof approvalReviewerSchema>;

export const runtimePermissionPolicySchema = z.discriminatedUnion("permissionMode", [
  z.object({
    permissionMode: z.literal("accept-edits"),
    permissionScope: z.literal("workspace"),
    approvalReviewer: z.literal("user"),
    permissionEscalation: permissionEscalationSchema,
  }),
  z.object({
    permissionMode: z.literal("auto"),
    permissionScope: z.literal("workspace"),
    approvalReviewer: z.literal("automatic"),
    permissionEscalation: permissionEscalationSchema,
  }),
  z.object({
    permissionMode: z.literal("full"),
    permissionScope: z.literal("full"),
    approvalReviewer: z.null(),
    permissionEscalation: z.null(),
  }),
]);
export type RuntimePermissionPolicy = z.infer<typeof runtimePermissionPolicySchema>;

const runtimeThreadExecutionBaseOptionsSchema = z.object({
  model: z.string().min(1).optional(),
  reasoningLevel: reasoningLevelSchema.optional(),
});

export const runtimeThreadExecutionOptionsSchema = runtimeThreadExecutionBaseOptionsSchema.and(
  runtimePermissionPolicySchema,
);
export type RuntimeThreadExecutionOptions = z.infer<typeof runtimeThreadExecutionOptionsSchema>;
