// ---------------------------------------------------------------------------
// Persisted renderer UI state — a generic key→JSON map saved to disk in the
// main process (~/.inteligir/ui-state.json). Backs panel layout, open panels,
// and any other view preference the renderer wants to survive restarts.
// ---------------------------------------------------------------------------

import { type Static, Type } from "@sinclair/typebox";

export const UiStateSchema = Type.Record(Type.String(), Type.Unknown());

export type UiState = Static<typeof UiStateSchema>;

export const UiStateSetSchema = Type.Object(
  { key: Type.String({ minLength: 1 }), value: Type.Unknown() },
  { additionalProperties: false },
);
