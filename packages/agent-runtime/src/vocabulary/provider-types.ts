// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// Trimmed: composer actions, tool-call request/response (dynamic tools are
// not carried) and the multi-provider info catalog are gone — codex is the
// one provider, so its capabilities are a constant here rather than a
// catalog lookup.

import { z } from "zod";
import { reasoningLevelSchema } from "./shared-types";

const modelReasoningEffortSchema = z.object({
  reasoningEffort: reasoningLevelSchema,
  description: z.string(),
});

const availableModelSchema = z.object({
  id: z.string(),
  model: z.string(),
  displayName: z.string(),
  description: z.string(),
  supportedReasoningEfforts: z.array(modelReasoningEffortSchema),
  defaultReasoningEffort: reasoningLevelSchema,
  isDefault: z.boolean(),
});
export type AvailableModel = z.infer<typeof availableModelSchema>;
