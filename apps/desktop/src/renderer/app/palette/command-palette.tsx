// shouldFilter is off: the search source and matchesQuery are the filtering,
// not cmdk's heuristics.

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
import { basenamePath } from "@repo/notes/knowledge/vault-path";
import {
  ArchiveRestoreIcon,
  CalendarIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderIcon,
  FolderInputIcon,
  MessagesSquareIcon,
  RefreshCwIcon,
  SettingsIcon,
  PrinterIcon,
  TextSearchIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { planMove } from "../sidebar/tree-ops";
import { threadActivity, THREAD_ACTIVITY_LABELS } from "../thread-activity";
import type { NoteSearchHit, NoteSearchSource } from "./note-search";

export interface PaletteActions {
  openNote: (path: string) => void;
  newNote: (parentDir: string) => void;
  openDailyNote: () => void;
  openThread: (threadId: string) => void;
  syncNow: () => void;
  openSettings: () => void;
  openDeletedNotes: () => void;
  findInNote: (() => void) | null;
  exportPdf: (() => void) | null;
  moveNote: (path: string, toDir: string) => void;
}

export interface CommandPaletteProps {
  open: boolean;
  initialQuery?: string;
  onOpenChange: (open: boolean) => void;
  entries: readonly VaultEntry[];
  threads: readonly Thread[];
  searchSource: NoteSearchSource;
  canSync: boolean;
  actions: PaletteActions;
  // the subject of the root "Move note to folder…" row; absent with no note open
  openNotePath?: string | null;
  // set at open, the palette starts on the folder page for this entry (the tree's Move to…)
  moveRequest?: string | null;
}

type Page = "root" | "new-note-folder" | "threads" | "move-to-folder";

function threadRowLabel(thread: Thread): string {
  return thread.title ?? "Action";
}

function threadRowDetail(thread: Thread): string {
  const activity = THREAD_ACTIVITY_LABELS[threadActivity(thread)];
  return thread.originDocPath === null ? activity : `${activity} · ${thread.originDocPath}`;
}

const SEARCH_DEBOUNCE_MS = 120;

interface StaticCommand {
  id: string;
  label: string;
  shortcut?: string;
  icon: React.ReactNode;
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
  openNotePath = null,
  moveRequest = null,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<Page>("root");
  const [moveSubject, setMoveSubject] = useState<string | null>(null);
  const [noteHits, setNoteHits] = useState<NoteSearchHit[]>([]);

  // Adjusted during render rather than in an effect, so the box is never
  // painted holding the previous opening's text.
  const [openedAs, setOpenedAs] = useState({ open: false, query: initialQuery, moveRequest });
  if (
    openedAs.open !== open ||
    openedAs.query !== initialQuery ||
    openedAs.moveRequest !== moveRequest
  ) {
    setOpenedAs({ open, query: initialQuery, moveRequest });
    if (open) {
      setQuery(initialQuery);
      setMoveSubject(moveRequest);
      setPage(moveRequest === null ? "root" : "move-to-folder");
    }
  }

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
    ...(actions.findInNote !== null
      ? [
          {
            id: "find-in-note",
            label: "Find in note",
            shortcut: "⌘F",
            icon: <TextSearchIcon />,
            run: () => actions.findInNote?.(),
          },
        ]
      : []),
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
    ...(openNotePath !== null
      ? [
          {
            id: "move-note",
            label: "Move note to folder…",
            icon: <FolderInputIcon />,
            keepOpen: true,
            run: () => {
              setQuery("");
              setMoveSubject(openNotePath);
              setPage("move-to-folder");
            },
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
      id: "deleted-notes",
      label: "Deleted notes",
      icon: <ArchiveRestoreIcon />,
      run: () => actions.openDeletedNotes(),
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

  if (page === "move-to-folder" && moveSubject !== null) {
    const subject = moveSubject;
    const folders = ["", ...dirPaths].filter(
      (dir) => planMove(subject, dir).ok && (dir === "" || matchesQuery(dir, query)),
    );
    return (
      <CommandDialog
        open={open}
        onOpenChange={onOpenChange}
        title={`Move ${basenamePath(subject)}`}
        description="Pick the folder to move it into"
        shouldFilter={false}
      >
        <CommandInput placeholder="Move to which folder?" value={query} onValueChange={setQuery} />
        <CommandList>
          <CommandEmpty>No folder it can move to.</CommandEmpty>
          <CommandGroup heading="Folders">
            {folders.map((dir) => (
              <CommandItem
                key={dir === "" ? "(root)" : dir}
                onSelect={() => run(() => actions.moveNote(subject, dir))}
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
