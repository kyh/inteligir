// The daily note — one hardcoded cadence for now; the configurable cadence
// system (weekly/monthly, folders, templates) returns with the settings
// surface that can carry it.

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Local date, not UTC: "today's note" follows the wall clock. */
function dailyNoteStem(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function dailyNotePath(now: Date): string {
  return `notes/daily/${dailyNoteStem(now)}.md`;
}

export function dailyNoteTemplate(now: Date): string {
  return `# ${dailyNoteStem(now)}\n\n`;
}
