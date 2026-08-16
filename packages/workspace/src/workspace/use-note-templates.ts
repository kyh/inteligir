import { useCallback } from "react";

import { titleFromPath } from "@repo/notes/knowledge/link-extract";
import { formatIsoDate, periodicNotePath } from "@repo/notes/daily-path";
import { CADENCES, applyTemplate, type Cadence } from "@repo/bridge/daily-notes";

import { getBridge } from "@repo/bridge/client";
import { parseStoredString, useDiskState } from "@repo/workspace/lib/use-disk-state";
import { useVaultActions } from "@repo/editor/host";

/** Read a template note's raw bytes, or null when it doesn't exist / is
 * unreadable — the seed is optional in every flow. */
async function readTemplate(path: string): Promise<string | null> {
  return getBridge()
    .readVaultFile({ path })
    .catch(() => null);
}

/**
 * "New note from template…" — create a note named `rawName` at the vault root,
 * seeded with the template's bytes and only `{{date}}`/`{{title}}` substituted.
 * Open-or-create, so a name collision just opens the existing note untouched.
 */
export function useCreateFromTemplate(): (templatePath: string, rawName: string) => void {
  const { createFile } = useVaultActions();
  return useCallback(
    (templatePath: string, rawName: string) => {
      const name = rawName.trim();
      if (name === "") return;
      void (async () => {
        const template = (await readTemplate(templatePath)) ?? "";
        const content = applyTemplate(template, {
          title: titleFromPath(name),
          date: formatIsoDate(new Date()),
        });
        await createFile(name, content);
      })();
    },
    [createFile],
  );
}

/**
 * Open-or-create this period's note for `cadence` — `<folder>/<formatted>.md`,
 * with folder + filename format from Settings → Notes. If the cadence's seed
 * template exists (`templates/daily.md`, `templates/weekly.md`,
 * `templates/monthly.md`) the new note starts from it with placeholders
 * substituted; otherwise it starts empty. Re-running opens the existing note
 * untouched — createFile is open-or-create.
 *
 * The three cadences differ ONLY in the config record this reads, which is why
 * ⌘D, "Open this week's note" and "Open this month's note" are one hook.
 * `{{date}}` stays TODAY's date for every cadence (the placeholder contract is
 * fixed — there is deliberately no `{{week}}`); the title placeholder is the
 * period's own filename, so a weekly template's `# {{title}}` reads `2026-W28`.
 */
export function useOpenPeriodicNote(cadence: Cadence): () => void {
  const { createFile } = useVaultActions();
  const config = CADENCES[cadence];
  const [folder] = useDiskState(config.folderKey, config.defaultFolder, parseStoredString);
  const [format] = useDiskState(config.formatKey, config.defaultFormat, parseStoredString);
  return useCallback(() => {
    void (async () => {
      const now = new Date();
      const path = periodicNotePath(folder, format, now);
      const template = await readTemplate(config.templatePath);
      const content =
        template === null
          ? ""
          : applyTemplate(template, { title: titleFromPath(path), date: formatIsoDate(now) });
      await createFile(path, content);
    })();
  }, [folder, format, config.templatePath, createFile]);
}

/** ⌘D / "Open today's note" — the daily cadence. Its own export because the
 * hotkey (workspace-page) is daily-only by design: weekly and monthly are
 * palette commands, not chords. */
export function useOpenDailyNote(): () => void {
  return useOpenPeriodicNote("daily");
}
