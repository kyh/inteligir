// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// Patched for this repo's no-assertion rule: the loose property reads off
// passthrough-parsed records go through explicit record guards, and the
// indexed reads carry the noUncheckedIndexedAccess fallbacks.

import { z } from "zod";
import { reasoningEffortsForLevels } from "../vocabulary/reasoning-efforts";
import type { AvailableModel, ModelReasoningEffort } from "../vocabulary/provider-types";
import { reasoningLevelSchema, type ReasoningLevel } from "../vocabulary/shared-types";
import type { JsonValue } from "../vocabulary/json-value.js";

const FALLBACK_REASONING_LEVEL: ReasoningLevel = "medium";

/** Soft by design: every optional field a Codex build might not send, or
 *  might send in a shape this version has no reading for, reads as absent
 *  rather than failing the model entry. Codex levels the runtime knows
 *  (including Codex-only "ultra") pass through the shared schema; unknown
 *  future names soft-fail the same way. */
const softText = z
  .string()
  .optional()
  .catch(() => undefined);

const codexReasoningEffortOptionSchema = z.looseObject({
  reasoningEffort: reasoningLevelSchema,
  description: softText,
});

const codexModelIdentitySchema = z.looseObject({
  id: z.string().min(1),
  model: z.string().min(1),
  displayName: softText,
  description: softText,
  isDefault: z
    .boolean()
    .optional()
    .catch(() => undefined),
  defaultReasoningEffort: reasoningLevelSchema.optional().catch(() => undefined),
  // An entry this version cannot read is skipped, not fatal to the model.
  supportedReasoningEfforts: z
    .array(codexReasoningEffortOptionSchema.nullable().catch(() => null))
    .optional()
    .catch(() => undefined),
});

type CodexReasoningEffortOption = z.infer<typeof codexReasoningEffortOptionSchema>;

/** Only the envelope is required; each entry inside is parsed leniently. */
const modelListPayloadSchema = z.looseObject({ data: z.array(z.unknown()) });

/**
 * Map a runtime ReasoningLevel to the string Codex app-server expects for
 * `model_reasoning_effort`. Returns null for levels Codex never accepts
 * (currently "none" and the Claude-specific "ultracode").
 */
export function mapBbReasoningLevelToCodex(level: ReasoningLevel): string | null {
  switch (level) {
    case "none":
    case "ultracode":
      return null;
    case "low":
    case "medium":
    case "high":
    case "xhigh":
    case "max":
    case "ultra":
      return level;
  }
}

function cloneDefaultReasoningEfforts(): ModelReasoningEffort[] {
  // reasoningEffortsForLevels already returns fresh objects per call.
  return reasoningEffortsForLevels(["low", "medium", "high", "xhigh"]);
}

function effortDescriptionForLevel(level: ReasoningLevel): string {
  return reasoningEffortsForLevels([level])[0]?.description ?? "";
}

function toModelReasoningEffort(option: CodexReasoningEffortOption): ModelReasoningEffort {
  return {
    reasoningEffort: option.reasoningEffort,
    description:
      option.description !== undefined && option.description.length > 0
        ? option.description
        : effortDescriptionForLevel(option.reasoningEffort),
  };
}

function parseSupportedReasoningEfforts(
  options: Array<CodexReasoningEffortOption | null> | undefined,
): ModelReasoningEffort[] {
  if (!options || options.length === 0) {
    return cloneDefaultReasoningEfforts();
  }

  const efforts: ModelReasoningEffort[] = [];
  const seen = new Set<ReasoningLevel>();
  for (const option of options) {
    if (!option || seen.has(option.reasoningEffort)) {
      continue;
    }
    seen.add(option.reasoningEffort);
    efforts.push(toModelReasoningEffort(option));
  }

  // All efforts unknown/unmapped — fall back rather than rejecting the model.
  return efforts.length > 0 ? efforts : cloneDefaultReasoningEfforts();
}

function toAvailableModel(raw: z.infer<typeof codexModelIdentitySchema>): AvailableModel {
  const efforts = parseSupportedReasoningEfforts(raw.supportedReasoningEfforts);
  const mappedDefault = raw.defaultReasoningEffort;
  const defaultReasoningEffort =
    mappedDefault && efforts.some((effort) => effort.reasoningEffort === mappedDefault)
      ? mappedDefault
      : (efforts[0]?.reasoningEffort ?? FALLBACK_REASONING_LEVEL);

  return {
    id: raw.id,
    model: raw.model,
    displayName:
      raw.displayName !== undefined && raw.displayName.length > 0 ? raw.displayName : raw.model,
    description: raw.description ?? "",
    supportedReasoningEfforts: efforts,
    defaultReasoningEffort,
    isDefault: raw.isDefault === true,
  };
}

/**
 * Parse Codex `model/list` results.
 *
 * Soft by design: unknown reasoning efforts are skipped, malformed model
 * entries are skipped, and only a completely unusable payload fails hard.
 * This keeps the model picker working when Codex introduces new effort names.
 */
export function parseModelsResponse(result: JsonValue): AvailableModel[] {
  const payload = modelListPayloadSchema.safeParse(result);
  if (!payload.success) {
    throw new Error("Invalid response from codex model/list.");
  }

  const models: AvailableModel[] = [];
  for (const entry of payload.data.data) {
    const identity = codexModelIdentitySchema.safeParse(entry);
    if (!identity.success) {
      continue;
    }
    models.push(toAvailableModel(identity.data));
  }

  if (models.length === 0) {
    throw new Error("Codex model/list returned no supported models.");
  }

  return models;
}
