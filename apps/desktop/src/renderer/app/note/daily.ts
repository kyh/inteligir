// The daily note — one hardcoded cadence for now; the configurable cadence
// system (weekly/monthly, folders, templates) returns with the settings
// surface that can carry it, and the path shape moves with it.

import { formatIsoDate } from "@repo/notes/iso-date";

const DAILY_FOLDER = "notes/daily";

export function dailyNotePath(now: Date): string {
  return `${DAILY_FOLDER}/${formatIsoDate(now)}.md`;
}

export function dailyNoteTemplate(now: Date): string {
  return `# ${formatIsoDate(now)}\n\n`;
}
