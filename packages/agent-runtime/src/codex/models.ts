// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
// Patched for this repo's no-assertion rule: the loose property reads off
// passthrough-parsed records go through explicit record guards, and the
// indexed reads carry the noUncheckedIndexedAccess fallbacks.

import { z } from "zod";
import { reasoningEffortsForLevels } from "../vocabulary/reasoning-efforts";
import type { AvailableModel, ModelReasoningEffort } from "../vocabulary/provider-types";
import { reasoningLevelSchema, type ReasoningLevel } from "../vocabulary/shared-types";
import { isRecord } from "../shared/provider-visibility-helpers.js";

const FALLBACK_REASONING_LEVEL: ReasoningLevel = "medium";

const codexModelIdentitySchema = z
  .object({
    id: z.string().min(1),
    model: z.string().min(1),
  })
  .passthrough();

/** Map a Codex-native reasoning effort string into a runtime ReasoningLevel. */
function mapCodexReasoningLevelToBb(value: unknown): ReasoningLevel | null {
  if (typeof value !== "string") {
    return null;
  }
  // Codex levels the runtime knows about (including Codex-only "ultra") pass
  // through via the shared schema. Unknown future names soft-fail to null.
  const parsed = reasoningLevelSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

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

function parseReasoningEffortOption(raw: unknown): ModelReasoningEffort | null {
  if (!isRecord(raw)) {
    return null;
  }
  const level = mapCodexReasoningLevelToBb(raw.reasoningEffort);
  if (!level) {
    return null;
  }
  const description =
    typeof raw.description === "string" && raw.description.length > 0
      ? raw.description
      : effortDescriptionForLevel(level);
  return {
    reasoningEffort: level,
    description,
  };
}

function parseSupportedReasoningEfforts(raw: unknown): ModelReasoningEffort[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return cloneDefaultReasoningEfforts();
  }

  const efforts: ModelReasoningEffort[] = [];
  const seen = new Set<ReasoningLevel>();
  for (const item of raw) {
    const effort = parseReasoningEffortOption(item);
    if (!effort || seen.has(effort.reasoningEffort)) {
      continue;
    }
    seen.add(effort.reasoningEffort);
    efforts.push(effort);
  }

  // All efforts unknown/unmapped — fall back rather than rejecting the model.
  return efforts.length > 0 ? efforts : cloneDefaultReasoningEfforts();
}

function toAvailableModel(raw: z.infer<typeof codexModelIdentitySchema>): AvailableModel {
  const efforts = parseSupportedReasoningEfforts(raw.supportedReasoningEfforts);
  const mappedDefault = mapCodexReasoningLevelToBb(raw.defaultReasoningEffort);
  const defaultReasoningEffort =
    mappedDefault && efforts.some((effort) => effort.reasoningEffort === mappedDefault)
      ? mappedDefault
      : (efforts[0]?.reasoningEffort ?? FALLBACK_REASONING_LEVEL);

  return {
    id: raw.id,
    model: raw.model,
    displayName:
      typeof raw.displayName === "string" && raw.displayName.length > 0
        ? raw.displayName
        : raw.model,
    description: typeof raw.description === "string" ? raw.description : "",
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
export function parseModelsResponse(result: unknown): AvailableModel[] {
  if (!isRecord(result)) {
    throw new Error("Invalid response from codex model/list.");
  }

  const data = result.data;
  if (!Array.isArray(data)) {
    throw new Error("Invalid response from codex model/list.");
  }

  const models: AvailableModel[] = [];
  for (const entry of data) {
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
