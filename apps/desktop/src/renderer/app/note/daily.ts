import { formatIsoDate } from "@repo/notes/iso-date";
import { removeFrontmatterId } from "@repo/notes/markdown/frontmatter";
import { expandTemplate } from "@repo/notes/templates/placeholders";

const DAILY_FOLDER = "notes/daily";

export function dailyNotePath(now: Date): string {
  return `${DAILY_FOLDER}/${formatIsoDate(now)}.md`;
}

export function dailyNoteTemplate(now: Date): string {
  return `# ${formatIsoDate(now)}\n\n`;
}

// the vault's `templates/Daily.md`, expanded with the day as its title
export function dailyNoteFromTemplate(template: string, now: Date): string {
  return removeFrontmatterId(expandTemplate(template, { now, title: formatIsoDate(now) }));
}
