import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@repo/ui/components/command";
import { hotkeyCaps, spellHotkey } from "@repo/ui/lib/hotkey-spelling";
import type { ShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import { GLOBAL_SHORTCUTS, globalShortcutHotkey } from "../global-shortcuts";
import { matchesQuery, PalettePage } from "./palette-page";

interface ShortcutRow {
  id: string;
  label: string;
  // the chord as one line, which the filter matches; the caps are what the row draws
  chord: string;
  caps: readonly string[];
}

const shortcutRow = (
  row: { action: string; label: string },
  hotkey: string,
  modifier: ShortcutModifier,
): ShortcutRow => ({
  caps: hotkeyCaps(hotkey, modifier),
  chord: spellHotkey(hotkey, modifier),
  id: row.action,
  label: row.label,
});

// derived from the table the listener reads, never a list of its own
const shortcutGroups = (
  modifier: ShortcutModifier,
): readonly { heading: string; rows: ShortcutRow[] }[] => [
  {
    heading: "Everywhere",
    rows: GLOBAL_SHORTCUTS.map((row) => shortcutRow(row, globalShortcutHotkey(row), modifier)),
  },
];

export interface ShortcutsPageProps {
  query: string;
  modifier: ShortcutModifier;
  onPick: () => void;
}

export const ShortcutsPage = ({ query, modifier, onPick }: ShortcutsPageProps) => {
  const groups = shortcutGroups(modifier)
    .map((group) => ({
      heading: group.heading,
      rows: group.rows.filter(
        (row) => matchesQuery(row.label, query) || matchesQuery(row.chord, query),
      ),
    }))
    .filter((group) => group.rows.length > 0);
  return (
    <PalettePage>
      <CommandEmpty>No shortcut matches.</CommandEmpty>
      {groups.map((group) => (
        <CommandGroup key={group.heading} heading={group.heading}>
          {group.rows.map((row) => (
            <CommandItem key={row.id} action={row.label} onSelect={onPick}>
              {row.label}
              <CommandShortcut caps={row.caps} />
            </CommandItem>
          ))}
        </CommandGroup>
      ))}
    </PalettePage>
  );
};
