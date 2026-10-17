// What a palette page draws under the palette's one field: its own controls, then the list it
// fills. The dialog, the field and the hint strip are the palette's, drawn once, so a page switch
// swaps only this. Every page filters its own rows, so nothing here matches a query.

import { CommandEmpty, CommandGroup, CommandItem, CommandList } from "@repo/ui/components/command";
import { FolderIcon } from "lucide-react";
import { useEffect, useState } from "react";

export const SEARCH_DEBOUNCE_MS = 120;

// the typed text, settled: a query keyed on it fires once per pause, not per keystroke
export const useDebounced = <T,>(value: T, ms: number): T => {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value);
    }, ms);
    return () => {
      clearTimeout(timer);
    };
  }, [value, ms]);
  return settled;
};

export const matchesQuery = (label: string, query: string): boolean =>
  label.toLowerCase().includes(query.trim().toLowerCase());

export interface PalettePageProps {
  // between the field and the list: the search page's match-case and whole-word toggles
  toolbar?: React.ReactNode;
  children: React.ReactNode;
}

export const PalettePage = ({ toolbar, children }: PalettePageProps) => (
  <>
    {toolbar}
    <CommandList>{children}</CommandList>
  </>
);

export interface FolderPageProps {
  empty: string;
  // already narrowed to the rows the page may offer; "" is the vault root
  folders: readonly string[];
  onPick: (dir: string) => void;
}

// the one picker behind "New note in folder…" and "Move to folder…"
export const FolderPage = ({ empty, folders, onPick }: FolderPageProps) => (
  <PalettePage>
    <CommandEmpty>{empty}</CommandEmpty>
    <CommandGroup heading="Folders">
      {folders.map((dir) => (
        <CommandItem
          key={dir === "" ? "(root)" : dir}
          action={dir === "" ? "Vault root" : dir}
          onSelect={() => {
            onPick(dir);
          }}
        >
          <FolderIcon />
          {dir === "" ? "Vault root" : dir}
        </CommandItem>
      ))}
    </CommandGroup>
  </PalettePage>
);
