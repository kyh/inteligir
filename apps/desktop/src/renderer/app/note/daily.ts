import { formatIsoDate } from "@repo/notes/iso-date";
import { removeFrontmatterId } from "@repo/notes/markdown/frontmatter";
import { DAILY_NOTES_FOLDER, expandTemplate } from "@repo/notes/templates/placeholders";

export const dailyNotePath = (now: Date): string =>
  `${DAILY_NOTES_FOLDER}/${formatIsoDate(now)}.md`;

export const dailyNoteTemplate = (now: Date): string => `# ${formatIsoDate(now)}\n\n`;

// the vault's `templates/Daily.md`, expanded with the day as its title
export const dailyNoteFromTemplate = (template: string, now: Date): string =>
  removeFrontmatterId(expandTemplate(template, { now, title: formatIsoDate(now) }));
