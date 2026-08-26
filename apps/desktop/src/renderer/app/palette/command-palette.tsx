// One palette, one query box: note hits from the INJECTED async search
// source (the workspace wires the knowledge index's full-text + tag search,
// filename tiers as the zero-query/fallback view) above the command list.
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
import type { Thread } from "@repo/api/local/threads/threads-schema";
import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import {
  CalendarIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderIcon,
  MessagesSquareIcon,
  RefreshCwIcon,
  SettingsIcon,
  Trash2Icon,
  PrinterIcon,
  ColumnsIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { threadActivity, THREAD_ACTIVITY_LABELS } from "../chat/chat-model";
import type { NoteSearchHit, NoteSearchSource } from "./note-search";

export interface PaletteActions {
  openNote: (path: string) => void;
  newNote: (parentDir: string) => void;
  openDailyNote: () => void;
  openThread: (threadId: string) => void;
  syncNow: () => void;
  openSettings: () => void;
  openTrash: () => void;
  /** Open a picked note in the split pane (#595). */
  openInSplit: (path: string) => void;
  /** Null while no split is open. */
  closeSplit: (() => void) | null;
  /** Null while no note is open — the row only exists with a document. */
  exportPdf: (() => void) | null;
}

export interface CommandPaletteProps {
  open: boolean;
  /** Seeded into the box whenever the palette opens (and whenever the seed
   * itself changes): a `#tag` chip click opens it as `tag:<name>`, which the
   * search source already understands — there is no second tag surface. */
  initialQuery?: string;
  onOpenChange: (open: boolean) => void;
  /** Folder listing for the new-note-in-folder page. */
  entries: readonly VaultEntry[];
  /** Recent actions, list order (live first, newest first). */
  threads: readonly Thread[];
  searchSource: NoteSearchSource;
  /** Hidden when the vault has no remote — a command that cannot run is
   *  noise, not affordance. */
  canSync: boolean;
  actions: PaletteActions;
}

type Page = "root" | "new-note-folder" | "threads" | "split-note";

function threadRowLabel(thread: Thread): string {
  return thread.title ?? "Action";
}

function threadRowDetail(thread: Thread): string {
  const activity = THREAD_ACTIVITY_LABELS[threadActivity(thread)];
  return thread.originDocPath === null ? activity : `${activity} · ${thread.originDocPath}`;
}

/** One quiet keystroke gap before the source is asked at all. */
const SEARCH_DEBOUNCE_MS = 120;

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
  initialQuery = "",
  onOpenChange,
  entries,
  threads,
  searchSource,
  canSync,
  actions,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<Page>("root");
  const [noteHits, setNoteHits] = useState<NoteSearchHit[]>([]);

  useEffect(() => {
    if (open) {
      setQuery(initialQuery);
      setPage("root");
    }
  }, [open, initialQuery]);

  // Async hits, debounced and abortable: a keystroke cancels the pending
  // timer AND aborts an in-flight request, and an aborted answer never
  // overwrites a fresh one.
  useEffect(() => {
    if (!open || page !== "root") {
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        let hits: NoteSearchHit[];
        try {
          hits = await searchSource(query, controller.signal);
        } catch {
          hits = [];
        }
        if (!controller.signal.aborted) {
          setNoteHits(hits);
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, page, query, searchSource]);

  const close = (): void => onOpenChange(false);
  const run = (action: () => void): void => {
    close();
    action();
  };

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
    ...(actions.exportPdf !== null
      ? [
          {
            id: "export-pdf",
            label: "Export as PDF",
            icon: <PrinterIcon />,
            run: () => actions.exportPdf?.(),
          },
        ]
      : []),
    {
      id: "open-in-split",
      label: "Open in split view…",
      icon: <ColumnsIcon />,
      keepOpen: true,
      run: () => {
        setQuery("");
        setPage("split-note");
      },
    },
    ...(actions.closeSplit !== null
      ? [
          {
            id: "close-split",
            label: "Close split view",
            icon: <ColumnsIcon />,
            run: () => actions.closeSplit?.(),
          },
        ]
      : []),
    {
      id: "threads",
      label: "Actions",
      icon: <MessagesSquareIcon />,
      keepOpen: true,
      run: () => {
        setQuery("");
        setPage("threads");
      },
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
      id: "open-trash",
      label: "Open trash",
      icon: <Trash2Icon />,
      run: () => actions.openTrash(),
    },
    {
      id: "settings",
      label: "Settings",
      icon: <SettingsIcon />,
      run: () => actions.openSettings(),
    },
  ];

  if (page === "threads") {
    const visibleThreads = threads
      .filter(
        (thread) =>
          matchesQuery(threadRowLabel(thread), query) ||
          matchesQuery(thread.originDocPath ?? "", query),
      )
      .slice(0, 30);
    return (
      <CommandDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Actions"
        description="Open a recent action in the panel"
        shouldFilter={false}
      >
        <CommandInput placeholder="Find an action…" value={query} onValueChange={setQuery} />
        <CommandList>
          <CommandEmpty>No actions yet.</CommandEmpty>
          <CommandGroup heading="Recent">
            {visibleThreads.map((thread) => (
              <CommandItem
                key={thread.id}
                onSelect={() => run(() => actions.openThread(thread.id))}
              >
                <MessagesSquareIcon />
                <span className="truncate">{threadRowLabel(thread)}</span>
                <span className="ml-auto truncate pl-3 text-xs text-muted-foreground">
                  {threadRowDetail(thread)}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    );
  }

  if (page === "split-note") {
    const docs = entries
      .filter((entry) => entry.kind === "file" && entry.path.endsWith(".md"))
      .filter((entry) => matchesQuery(entry.path, query))
      .slice(0, 30);
    return (
      <CommandDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Open in split view"
        description="Pick the note for the split pane"
        shouldFilter={false}
      >
        <CommandInput placeholder="Split with…" value={query} onValueChange={setQuery} />
        <CommandList>
          <CommandEmpty>No notes match.</CommandEmpty>
          <CommandGroup heading="Notes">
            {docs.map((entry) => (
              <CommandItem
                key={entry.path}
                onSelect={() => run(() => actions.openInSplit(entry.path))}
              >
                <ColumnsIcon />
                <span className="truncate">{entry.path}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    );
  }

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
                <span className="truncate">
                  {hit.title !== undefined && hit.title !== "" ? hit.title : hit.path}
                </span>
                {hit.title !== undefined && hit.title !== "" ? (
                  <span className="ml-auto truncate pl-3 text-xs text-muted-foreground">
                    {hit.path}
                  </span>
                ) : null}
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
