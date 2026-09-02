import { formatIsoDate } from "@repo/notes/iso-date";

const DAILY_FOLDER = "notes/daily";

export function dailyNotePath(now: Date): string {
  return `${DAILY_FOLDER}/${formatIsoDate(now)}.md`;
}

export function dailyNoteTemplate(now: Date): string {
  return `# ${formatIsoDate(now)}\n\n`;
}
