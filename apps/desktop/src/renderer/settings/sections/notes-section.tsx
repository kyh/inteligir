import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";

import {
  DAILY_FOLDER_KEY,
  DAILY_FORMAT_KEY,
  DEFAULT_DAILY_FOLDER,
  DEFAULT_DAILY_FORMAT,
} from "@renderer/lib/apply-template";
import { useDiskState } from "@renderer/lib/use-disk-state";

const parseString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

// Daily-note location. Both fields persist through the generic ui-state channel
// (~/.inteligir/ui-state.json) via useDiskState — the same lightweight store the
// palette + ⌘D read to build today's note path. Templates themselves are a
// vault-folder convention (`templates/`), so there's nothing to configure for
// them here.
export function NotesSection() {
  const [folder, setFolder, loaded] = useDiskState(
    DAILY_FOLDER_KEY,
    DEFAULT_DAILY_FOLDER,
    parseString,
  );
  const [format, setFormat] = useDiskState(DAILY_FORMAT_KEY, DEFAULT_DAILY_FORMAT, parseString);

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-medium text-muted-foreground">Notes</Label>
      <div className="flex flex-col gap-2 rounded-[12px] bg-muted px-3 py-2">
        <p className="text-[10px] text-muted-foreground">
          Daily note location, opened with ⌘D or “Open today's note”. Seeded from{" "}
          <code>templates/daily.md</code> when it exists.
        </p>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-muted-foreground">Folder</span>
          <Input
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder={DEFAULT_DAILY_FOLDER}
            className="h-7 text-xs"
            disabled={!loaded}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-muted-foreground">Filename format (YYYY, MM, DD)</span>
          <Input
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            placeholder={DEFAULT_DAILY_FORMAT}
            className="h-7 text-xs"
            disabled={!loaded}
          />
        </div>
      </div>
    </div>
  );
}
