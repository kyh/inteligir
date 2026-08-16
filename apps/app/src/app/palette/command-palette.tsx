// One palette, one query box: note hits from the swappable search source
// (filename tiers today, full-text with #547) above the command list.
// Filtering is entirely ours (shouldFilter off) so the note source and the
// command matcher stay two visible functions rather than cmdk heuristics.

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@repo/ui/components/command";
import type { VaultEntry } from "@repo/server-contract/vault";
import {
  CalendarIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderIcon,
  RefreshCwIcon,
  SettingsIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { searchNotesByFilename } from "./note-search";

export interface PaletteActions {
  openNote: (path: string) => void;
  newNote: (parentDir: string) => void;
  openDailyNote: () => void;
  syncNow: () => void;
  openSettings: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: readonly VaultEntry[];
  /** Hidden when the vault has no remote — a command that cannot run is
   *  noise, not affordance. */
  canSync: boolean;
  actions: PaletteActions;
}

type Page = "root" | "new-note-folder";

interface StaticCommand {
  id: string;
  label: string;
  shortcut?: string;
  icon: React.ReactNode;
  /** The palette stays open (the command navigates to another page). */
  keepOpen?: boolean;
  run: () => void;
}

function matchesQuery(label: string, query: string): boolean {
  return label.toLowerCase().includes(query.trim().toLowerCase());
}

export function CommandPalette({
  open,
  onOpenChange,
  entries,
  canSync,
  actions,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<Page>("root");

  useEffect(() => {
    if (open) {
      setQuery("");
      setPage("root");
    }
  }, [open]);

  const close = (): void => onOpenChange(false);
  const run = (action: () => void): void => {
    close();
    action();
  };

  const filePaths = entries.filter((entry) => entry.kind === "file").map((entry) => entry.path);
  const dirPaths = entries.filter((entry) => entry.kind === "dir").map((entry) => entry.path);

  const commands: StaticCommand[] = [
    {
      id: "new-note",
      label: "New note",
      icon: <FilePlusIcon />,
      run: () => actions.newNote(""),
    },
    {
      id: "new-note-in-folder",
      label: "New note in folder…",
      icon: <FolderIcon />,
      keepOpen: true,
      run: () => {
        setQuery("");
        setPage("new-note-folder");
      },
    },
    {
      id: "daily-note",
      label: "Daily note",
      shortcut: "⌘D",
      icon: <CalendarIcon />,
      run: () => actions.openDailyNote(),
    },
    ...(canSync
      ? [
          {
            id: "sync-now",
            label: "Sync now",
            icon: <RefreshCwIcon />,
            run: () => actions.syncNow(),
          },
        ]
      : []),
    {
      id: "settings",
      label: "Settings",
      icon: <SettingsIcon />,
      run: () => actions.openSettings(),
    },
  ];

  if (page === "new-note-folder") {
    const folders = ["", ...dirPaths].filter((dir) => dir === "" || matchesQuery(dir, query));
    return (
      <CommandDialog
        open={open}
        onOpenChange={onOpenChange}
        title="New note in folder"
        description="Pick the folder for the new note"
        shouldFilter={false}
      >
        <CommandInput
          placeholder="New note in which folder?"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>No matching folder.</CommandEmpty>
          <CommandGroup heading="Folders">
            {folders.map((dir) => (
              <CommandItem
                key={dir === "" ? "(root)" : dir}
                onSelect={() => run(() => actions.newNote(dir))}
              >
                <FolderIcon />
                {dir === "" ? "Vault root" : dir}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    );
  }

  const noteHits = searchNotesByFilename(query, filePaths);
  const visibleCommands = commands.filter((command) => matchesQuery(command.label, query));

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Open a note or run a command"
      shouldFilter={false}
    >
      <CommandInput
        placeholder="Search notes or commands…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>Nothing matches.</CommandEmpty>
        {noteHits.length > 0 ? (
          <CommandGroup heading="Notes">
            {noteHits.map((hit) => (
              <CommandItem key={hit.path} onSelect={() => run(() => actions.openNote(hit.path))}>
                <FileTextIcon />
                <span className="truncate">{hit.path}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {visibleCommands.length > 0 ? (
          <CommandGroup heading="Commands">
            {visibleCommands.map((command) => (
              <CommandItem
                key={command.id}
                onSelect={() => (command.keepOpen === true ? command.run() : run(command.run))}
              >
                {command.icon}
                {command.label}
                {command.shortcut !== undefined ? (
                  <CommandShortcut>{command.shortcut}</CommandShortcut>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
