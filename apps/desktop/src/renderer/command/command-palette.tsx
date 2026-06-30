import { useCallback, useRef, useState } from "react";
import { FilePlusIcon, FileTextIcon, FolderIcon, MoonIcon, SunIcon } from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@repo/ui/components/command";

import { useTheme } from "@/renderer/lib/use-theme";
import { useVault } from "@/renderer/workspace/vault-context";

/**
 * The ⌘K command palette: fuzzy-search notes to jump to them, create a note
 * from the typed name, and run a handful of workspace commands. Opened by ⌘K
 * (WorkspacePage) and the sidebar's "Quick actions" pill.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { entries, openFile, createFile, changeFolder } = useVault();
  const { resolved, setTheme } = useTheme();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    onOpenChange(false);
    setQuery("");
  }, [onOpenChange]);

  // Run an action then dismiss — every item closes the palette.
  const run = useCallback(
    (action: () => void) => {
      action();
      close();
    },
    [close],
  );

  const trimmed = query.trim();
  const lower = trimmed.toLowerCase();
  const exists = entries.some(
    (e) => e.path.toLowerCase() === lower || e.path.toLowerCase() === `${lower}.md`,
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      initialFocus={inputRef}
    >
      <CommandInput
        ref={inputRef}
        value={query}
        onValueChange={setQuery}
        placeholder="Search notes or run a command…"
      />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>

        {entries.length > 0 && (
          <CommandGroup heading="Notes">
            {entries.map((e) => (
              <CommandItem key={e.path} value={e.path} onSelect={() => run(() => openFile(e.path))}>
                <FileTextIcon />
                <span className="truncate">{e.path}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {trimmed.length > 0 && !exists && (
          <CommandGroup heading="Create">
            <CommandItem
              value={`__create__ ${trimmed}`}
              onSelect={() => run(() => void createFile(trimmed))}
            >
              <FilePlusIcon />
              <span>
                Create <span className="font-medium text-foreground">{trimmed}</span>
              </span>
            </CommandItem>
          </CommandGroup>
        )}

        <CommandGroup heading="Actions">
          <CommandItem
            value="toggle theme dark light appearance"
            onSelect={() => run(() => setTheme(resolved === "dark" ? "light" : "dark"))}
          >
            {resolved === "dark" ? <SunIcon /> : <MoonIcon />}
            <span>Switch to {resolved === "dark" ? "light" : "dark"} theme</span>
          </CommandItem>
          <CommandItem
            value="switch vault folder change directory"
            onSelect={() => run(() => void changeFolder())}
          >
            <FolderIcon />
            <span>Switch vault folder…</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
