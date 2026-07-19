import { useCallback } from "react";

import { titleFromPath } from "@repo/notes/knowledge/link-extract";
import { dailyNotePath, formatIsoDate } from "@repo/notes/notes/daily-path";
import {
  DAILY_FOLDER_KEY,
  DAILY_FORMAT_KEY,
  DAILY_TEMPLATE_PATH,
  DEFAULT_DAILY_FOLDER,
  DEFAULT_DAILY_FORMAT,
  applyTemplate,
} from "@repo/bridge/daily-notes";

import { getBridge } from "@renderer/lib/bridge";
import { useDiskState } from "@renderer/lib/use-disk-state";
import { useVault } from "@renderer/workspace/vault-context";

const parseString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

/** Read a template note's raw bytes, or null when it doesn't exist / is
 * unreadable — the seed is optional in every flow. */
async function readTemplate(path: string): Promise<string | null> {
  return getBridge()
    .readVaultDoc({ path })
    .catch(() => null);
}

/**
 * "New note from template…" — create a note named `rawName` at the vault root,
 * seeded with the template's bytes and only `{{date}}`/`{{title}}` substituted.
 * Open-or-create, so a name collision just opens the existing note untouched.
 */
export function useCreateFromTemplate(): (templatePath: string, rawName: string) => void {
  const { openOrCreateNote } = useVault();
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
        await openOrCreateNote(name, content);
      })();
    },
    [openOrCreateNote],
  );
}

/**
 * "Open today's note" — open-or-create `<folder>/<date>.md` (folder + filename
 * format from Settings → Notes). If `templates/daily.md` exists, the new note
 * is seeded from it with placeholders substituted; otherwise it starts empty.
 */
export function useOpenDailyNote(): () => void {
  const { openOrCreateNote } = useVault();
  const [folder] = useDiskState(DAILY_FOLDER_KEY, DEFAULT_DAILY_FOLDER, parseString);
  const [format] = useDiskState(DAILY_FORMAT_KEY, DEFAULT_DAILY_FORMAT, parseString);
  return useCallback(() => {
    void (async () => {
      const now = new Date();
      const path = dailyNotePath(folder, format, now);
      const template = await readTemplate(DAILY_TEMPLATE_PATH);
      const content =
        template === null
          ? ""
          : applyTemplate(template, { title: titleFromPath(path), date: formatIsoDate(now) });
      await openOrCreateNote(path, content);
    })();
  }, [folder, format, openOrCreateNote]);
}
