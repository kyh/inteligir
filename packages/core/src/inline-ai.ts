import { Type } from "@sinclair/typebox";

// Inline-AI generation IPC. The renderer builds the full prompt (action +
// selected/context text) and a requestId to correlate the streamed deltas, and
// gets back the assistant's final text.
export const AiGenerateParamsSchema = Type.Object(
  { prompt: Type.String({ minLength: 1 }), requestId: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);

export type AiGenerateResult = { ok: true; text: string } | { ok: false; error: string };

/** Cancel an in-flight AI request by the caller's requestId (inline generation
 * or ghost completion). A mismatched id is a no-op — the request already
 * finished or was superseded. */
export const AiCancelParamsSchema = Type.Object(
  { requestId: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);

// ---------------------------------------------------------------------------
// Intent classification — routes a free-form AI-menu prompt to the generate
// flow (streaming insert) or the edit flow (track-changes suggestions). Runs
// host-side on the inline-AI session; parse failures fall back to "generate"
// (the non-destructive branch).
// ---------------------------------------------------------------------------

export const AiIntentParamsSchema = Type.Object(
  { prompt: Type.String({ minLength: 1 }), hasSelection: Type.Boolean() },
  { additionalProperties: false },
);

export type AiIntent = "generate" | "edit";

export type AiIntentResult = { intent: AiIntent };

/**
 * Robust parse of a classifier response into an intent. Accepts bare words
 * ("edit"), sentences ("The intent is: EDIT."), or JSON ({"intent":"edit"}),
 * in any casing. Anything unrecognizable — or a response naming both —
 * resolves to "generate": inserting text the user can discard is strictly
 * safer than rewriting their selection.
 */
export function parseAiIntent(text: string): AiIntent {
  const words: string[] = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const edit = words.includes("edit");
  const generate = words.includes("generate");
  return edit && !generate ? "edit" : "generate";
}

// ---------------------------------------------------------------------------
// Ghost text — copilot-style inline completion on a dedicated FAST session.
// The renderer builds the full prompt (instruction + current block) and a
// requestId; a new request supersedes the previous one host-side.
// ---------------------------------------------------------------------------

export const GhostTextParamsSchema = Type.Object(
  { prompt: Type.String({ minLength: 1 }), requestId: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);

export type GhostTextResult = { ok: true; text: string } | { ok: false; error: string };

/** One selectable ghost-text model (from pi's model registry). */
export type GhostModel = { id: string; label: string };

export type GhostModelsResult = {
  models: GhostModel[];
  /** The id the host uses when no explicit choice is stored. */
  defaultId: string | null;
};

/** ui-state key: ghost-text feature flag (missing = enabled; a stored `false`
 * — the Settings toggle — disables). */
export const GHOST_TEXT_ENABLED_UI_STATE = "ghostTextEnabled";

/** ui-state key: ghost-text model id override (missing = host default). */
export const GHOST_TEXT_MODEL_UI_STATE = "ghostTextModel";
