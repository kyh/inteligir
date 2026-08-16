// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// Trimmed: composer actions, tool-call request/response (dynamic tools are
// not carried) and the multi-provider info catalog are gone — codex is the
// one provider, so its capabilities are a constant here rather than a
// catalog lookup.

import { z } from "zod";
import { permissionModeSchema, reasoningLevelSchema } from "./shared-types";

export const modelReasoningEffortSchema = z.object({
  reasoningEffort: reasoningLevelSchema,
  description: z.string(),
});
export type ModelReasoningEffort = z.infer<typeof modelReasoningEffortSchema>;

export const availableModelSchema = z.object({
  id: z.string(),
  model: z.string(),
  displayName: z.string(),
  description: z.string(),
  supportedReasoningEfforts: z.array(modelReasoningEffortSchema),
  defaultReasoningEffort: reasoningLevelSchema,
  isDefault: z.boolean(),
});
export type AvailableModel = z.infer<typeof availableModelSchema>;

export const providerCapabilitiesSchema = z.object({
  supportsUserQuestion: z.boolean(),
  supportedPermissionModes: z.array(permissionModeSchema).min(1),
});
export type ProviderCapabilities = z.infer<typeof providerCapabilitiesSchema>;

/** bb resolves this from its provider catalog; with one provider it is a fact. */
export const CODEX_PROVIDER_CAPABILITIES: ProviderCapabilities = {
  supportsUserQuestion: false,
  supportedPermissionModes: ["accept-edits", "auto", "full"],
};
