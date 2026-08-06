// The ONE host-side resolver for "today's note", over the same two ui-state
// keys the workspace's own ⌘D and Settings → Notes read. A routine's `daily`
// target lands here, and it resolves PER RUN rather than at save time — a
// routine created in June must write into December's note in December.

import {
  DAILY_FOLDER_KEY,
  DAILY_FORMAT_KEY,
  DEFAULT_DAILY_FOLDER,
  DEFAULT_DAILY_FORMAT,
} from "@repo/bridge/daily-notes";
import type { UiState } from "@repo/bridge/ui-state";
import { dailyNotePath } from "@repo/notes/daily-path";

export function resolveDailyNotePath(uiState: UiState, now: Date): string {
  const folder = uiState[DAILY_FOLDER_KEY];
  const format = uiState[DAILY_FORMAT_KEY];
  return dailyNotePath(
    typeof folder === "string" ? folder : DEFAULT_DAILY_FOLDER,
    typeof format === "string" ? format : DEFAULT_DAILY_FORMAT,
    now,
  );
}
