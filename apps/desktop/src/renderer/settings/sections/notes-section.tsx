import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";

import {
  CADENCE_ORDER,
  CADENCES,
  type Cadence,
  type CadenceConfig,
} from "@repo/bridge/daily-notes";
import { useDiskState } from "@renderer/lib/use-disk-state";

const parseString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

// Periodic-note locations, one group per cadence. Every field persists through
// the generic ui-state channel (~/.inteligir/ui-state.json) via useDiskState —
// the same lightweight store the palette + ⌘D read to build the note's path.
// Templates themselves are a vault-folder convention (`templates/`), so
// there's nothing to configure for them here.
export function NotesSection() {
  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-medium text-muted-foreground">Notes</Label>
      {CADENCE_ORDER.map((cadence) => (
        <CadenceRows key={cadence} config={CADENCES[cadence]} />
      ))}
    </div>
  );
}

/** How each cadence is reached, appended to its group's hint line. Kept beside
 * the copy it belongs to rather than in the isomorphic cadence table, which the
 * host reads and has no notion of the palette. */
const REACHED_BY: Record<Cadence, string> = {
  daily: "⌘D or “Open today's note”",
  weekly: "“Open this week's note”",
  monthly: "“Open this month's note”",
};

/** One cadence's folder + filename-format pair. A hook per FIELD, so this is a
 * component rather than a loop body — useDiskState can't be called in a map. */
function CadenceRows({ config }: { config: CadenceConfig }) {
  const [folder, setFolder, loaded] = useDiskState(
    config.folderKey,
    config.defaultFolder,
    parseString,
  );
  const [format, setFormat] = useDiskState(config.formatKey, config.defaultFormat, parseString);

  return (
    <div className="flex flex-col gap-2 rounded-[12px] bg-muted px-3 py-2">
      <p className="text-[10px] text-muted-foreground">
        {config.settingsLabel} location, opened with {REACHED_BY[config.cadence]}. Seeded from{" "}
        <code>{config.templatePath}</code> when it exists.
      </p>
      <div className="flex flex-col gap-1">
        <span className="text-[10px] text-muted-foreground">Folder</span>
        <Input
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          placeholder={config.defaultFolder}
          className="h-7 text-xs"
          disabled={!loaded}
          aria-label={`${config.settingsLabel} folder`}
        />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[10px] text-muted-foreground">
          Filename format ({config.formatTokens})
        </span>
        <Input
          value={format}
          onChange={(e) => setFormat(e.target.value)}
          placeholder={config.defaultFormat}
          className="h-7 text-xs"
          disabled={!loaded}
          aria-label={`${config.settingsLabel} filename format`}
        />
      </div>
    </div>
  );
}
