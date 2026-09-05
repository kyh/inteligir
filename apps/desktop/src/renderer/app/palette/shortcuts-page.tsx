import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@repo/ui/components/command";
import { EDITOR_SHORTCUTS } from "@repo/editor/editor-shortcuts";
import { FIND_BAR_SHORTCUTS } from "@repo/editor/find-bar";
import { spellHotkey, type ShortcutModifier } from "@repo/editor/hotkey-spelling";
import { MARK_SHORTCUTS } from "@repo/editor/mark-shortcuts";
import { GLOBAL_SHORTCUTS, globalShortcutHotkey } from "../global-shortcuts";
import { matchesQuery, PalettePage, type PageShell } from "./palette-page";

interface ShortcutRow {
  id: string;
  label: string;
  chord: string;
}

// derived from the tables the listeners read, never a list of its own
function shortcutGroups(
  modifier: ShortcutModifier,
): readonly { heading: string; rows: ShortcutRow[] }[] {
  return [
    {
      heading: "Everywhere",
      rows: GLOBAL_SHORTCUTS.map((row) => ({
        id: row.action,
        label: row.label,
        chord: spellHotkey(globalShortcutHotkey(row), modifier),
      })),
    },
    {
      heading: "In the note",
      rows: [...MARK_SHORTCUTS, ...EDITOR_SHORTCUTS, ...FIND_BAR_SHORTCUTS].map((row) => ({
        id: row.action,
        label: row.label,
        chord: spellHotkey(row.hotkey, modifier),
      })),
    },
  ];
}

export interface ShortcutsPageProps extends PageShell {
  modifier: ShortcutModifier;
  onPick: () => void;
}

export function ShortcutsPage({ modifier, onPick, ...shell }: ShortcutsPageProps) {
  const groups = shortcutGroups(modifier)
    .map((group) => ({
      heading: group.heading,
      rows: group.rows.filter(
        (row) => matchesQuery(row.label, shell.query) || matchesQuery(row.chord, shell.query),
      ),
    }))
    .filter((group) => group.rows.length > 0);
  return (
    <PalettePage
      {...shell}
      title="Keyboard shortcuts"
      description="Every binding, spelled for this keyboard"
      placeholder="Filter shortcuts…"
    >
      <CommandEmpty>No shortcut matches.</CommandEmpty>
      {groups.map((group) => (
        <CommandGroup key={group.heading} heading={group.heading}>
          {group.rows.map((row) => (
            <CommandItem key={row.id} value={row.id} onSelect={onPick}>
              {row.label}
              <CommandShortcut>{row.chord}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
      ))}
    </PalettePage>
  );
}
