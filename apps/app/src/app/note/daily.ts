// The daily note — one hardcoded cadence for now; the configurable cadence
// system (weekly/monthly, folders, templates) returns with the settings
// surface that can carry it. Path math is @repo/notes' daily-path module —
// the SAME builder every other "today's note" surface uses.

import { dailyNotePath as buildDailyNotePath, formatIsoDate } from "@repo/notes/daily-path";

const DAILY_FOLDER = "notes/daily";
const DAILY_FILENAME_FORMAT = "YYYY-MM-DD";

export function dailyNotePath(now: Date): string {
  return buildDailyNotePath(DAILY_FOLDER, DAILY_FILENAME_FORMAT, now);
}

export function dailyNoteTemplate(now: Date): string {
  return `# ${formatIsoDate(now)}\n\n`;
}
