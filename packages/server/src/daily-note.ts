import { dailyNotePath } from "@repo/notes/daily-path";
import {
  DAILY_FOLDER_KEY,
  DAILY_FORMAT_KEY,
  DEFAULT_DAILY_FOLDER,
  DEFAULT_DAILY_FORMAT,
} from "@repo/bridge/daily-notes";
import { getUiState } from "./ui-state";

/** Resolve the daily-note path for `now` from the ui-state Settings → Notes
 * folder/format (defaults when unset) — the ONE host-side resolver, shared by
 * the capture drain and routines' daily target. The renderer resolves its own
 * copy over the same keys. */
export function resolveDailyNotePath(now: Date): string {
  const uiState = getUiState().getAll();
  const folder = uiState[DAILY_FOLDER_KEY];
  const format = uiState[DAILY_FORMAT_KEY];
  return dailyNotePath(
    typeof folder === "string" ? folder : DEFAULT_DAILY_FOLDER,
    typeof format === "string" ? format : DEFAULT_DAILY_FORMAT,
    now,
  );
}
