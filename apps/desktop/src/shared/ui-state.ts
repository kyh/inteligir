// ---------------------------------------------------------------------------
// Persisted renderer UI state — a generic key→JSON map saved to disk in the
// main process (~/.inteligir/ui-state.json). Backs panel layout, open panels,
// and any other view preference the renderer wants to survive restarts.
// ---------------------------------------------------------------------------

import { z } from "zod";

export const UiStateSchema = z.record(z.string(), z.unknown());

export type UiState = z.infer<typeof UiStateSchema>;

export const UiStateSetSchema = z.object({
  key: z.string().min(1),
  value: z.unknown(),
});

export type UiStateSet = z.infer<typeof UiStateSetSchema>;
