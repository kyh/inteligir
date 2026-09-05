import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@repo/ui/components/command";
import type { VaultMatchWire } from "@repo/api/local/knowledge/knowledge-schema";
import type { Thread } from "@repo/api/local/threads/threads-schema";
import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import { basenamePath } from "@repo/notes/knowledge/vault-path";
import { isTemplatePath } from "@repo/notes/templates/placeholders";
import { platformShortcutModifier, type ShortcutModifier } from "@repo/editor/hotkey-spelling";
import type { HeadingItem } from "@repo/editor/toc";
import { useQuery } from "@tanstack/react-query";
import {
  ArchiveRestoreIcon,
  CalendarIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderIcon,
  FolderInputIcon,
  HeadingIcon,
  KeyboardIcon,
  LayoutTemplateIcon,
  MessagesSquareIcon,
  PinIcon,
  PinOffIcon,
  RefreshCwIcon,
  SearchIcon,
  SettingsIcon,
  PrinterIcon,
  TextSearchIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useState } from "react";
import { bindingFor, type GlobalShortcutAction } from "../global-shortcuts";
import { planMove } from "../sidebar/tree-ops";
import { threadActivity, THREAD_ACTIVITY_LABELS } from "../thread-activity";
import { vaultFolders } from "../vault-hooks";
import type { NoteSearchHit, NoteSearchSource } from "./note-search";
import {
  FolderPage,
  matchesQuery,
  PalettePage,
  SEARCH_DEBOUNCE_MS,
  TemplateRows,
  useDebounced,
} from "./palette-page";
import { ProblemsPage } from "./problems-page";
import { SearchPage } from "./search-page";
import { ShortcutsPage } from "./shortcuts-page";
import type { ReplaceProgressPort, VaultReplaceRequest } from "./vault-replace";

export interface PaletteActions {
  openNote: (path: string) => void;
  newNote: (parentDir: string) => void;
  newNoteFromTemplate: (templatePath: string) => void;
  openDailyNote: () => void;
  openThread: (threadId: string) => void;
  syncNow: () => void;
  openSettings: () => void;
  openDeletedNotes: () => void;
  findInNote: (() => void) | null;
  insertTemplate: ((templatePath: string) => void) | null;
  exportPdf: (() => void) | null;
  moveNote: (path: string, toDir: string) => void;
  // the open note's pin state and the one verb that flips it; absent with no note open
  pin: { pinned: boolean; toggle: () => void } | null;
  openMatch: (match: VaultMatchWire, query: string) => void;
  // settles when the run is over, cancelled or declined included; the palette shows it running
  replaceAll: (request: VaultReplaceRequest, port: ReplaceProgressPort) => Promise<void>;
  // the open note's outline, walked when the page asks; absent with no note open
  listHeadings: (() => readonly HeadingItem[]) | null;
  goToHeading: (heading: HeadingItem) => void;
  // opens the source note and lands on the link written against `target`
  openProblemLink: (sourcePath: string, target: string) => void;
}

// the pages an entry point opens onto; "notes" is the root with its commands folded away (⌘O)
export type PaletteEntryPage = "root" | "search" | "notes" | "headings" | "move-to-folder";

// One channel for every way the palette opens: the page, and for a move the entry it moves. The
// workspace bumps `nonce` per open and keys the palette on it, so each open mounts fresh and no
// state from the last open needs resetting.
export interface PaletteRequest {
  page: PaletteEntryPage;
  subject?: string;
  nonce: number;
}

export interface CommandPaletteProps {
  open: boolean;
  request: PaletteRequest;
  // how a binding is spelled; the workspace passes the one it listens with
  modifier?: ShortcutModifier;
  onOpenChange: (open: boolean) => void;
  entries: readonly VaultEntry[];
  threads: readonly Thread[];
  searchSource: NoteSearchSource;
  canSync: boolean;
  actions: PaletteActions;
  // the subject of the root "Move note to folder…" row; absent with no note open
  openNotePath?: string | null;
}

type Page =
  | PaletteEntryPage
  | "new-note-folder"
  | "new-note-template"
  | "insert-template"
  | "threads"
  | "shortcuts"
  | "problems";

function threadRowLabel(thread: Thread): string {
  return thread.title ?? "Action";
}

function threadRowDetail(thread: Thread): string {
  const activity = THREAD_ACTIVITY_LABELS[threadActivity(thread)];
  return thread.originDocPath === null ? activity : `${activity} · ${thread.originDocPath}`;
}

interface StaticCommand {
  id: string;
  label: string;
  // the row's binding comes from the global table, so the palette never spells a chord itself
  binding?: GlobalShortcutAction;
  icon: React.ReactNode;
  keepOpen?: boolean;
  run: () => void;
}

export function CommandPalette({
  open,
  request,
  modifier = platformShortcutModifier(),
  onOpenChange,
  entries,
  threads,
  searchSource,
  canSync,
  actions,
  openNotePath = null,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<Page>(request.page);
  // the entry a move page is for: the request's, or the open note the root row named
  const [moveSubject, setMoveSubject] = useState<string | null>(request.subject ?? null);
  const settledQuery = useDebounced(query, SEARCH_DEBOUNCE_MS);

  // a source, not a route: it merges the filename fallback the index cannot answer. A superseded
  // read is aborted by the cache itself: the key's last observer moving on cancels a fetch that
  // consumed its signal.
  const noteHitsQuery = useQuery({
    queryKey: ["palette", "note-hits", settledQuery],
    queryFn: ({ signal }) => searchSource(settledQuery, signal).catch((): NoteSearchHit[] => []),
    enabled: open && (page === "root" || page === "notes"),
    placeholderData: (previous) => previous,
  });
  const noteHits = noteHitsQuery.data ?? [];

  const close = (): void => onOpenChange(false);
  const run = (action: () => void): void => {
    close();
    action();
  };
  const goTo = (next: Page): void => {
    setQuery("");
    setPage(next);
  };

  const folders = vaultFolders(entries);
  const templatePaths = entries
    .filter((entry) => entry.kind === "file" && isTemplatePath(entry.path))
    .map((entry) => entry.path);

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
      run: () => goTo("new-note-folder"),
    },
    {
      id: "new-note-from-template",
      label: "New note from template…",
      icon: <LayoutTemplateIcon />,
      keepOpen: true,
      run: () => goTo("new-note-template"),
    },
    {
      id: "daily-note",
      label: "Daily note",
      binding: "open-daily-note",
      icon: <CalendarIcon />,
      run: () => actions.openDailyNote(),
    },
    ...(actions.findInNote !== null
      ? [
          {
            id: "find-in-note",
            label: "Find in note",
            binding: "find-in-note" as const,
            icon: <TextSearchIcon />,
            run: () => actions.findInNote?.(),
          },
        ]
      : []),
    ...(actions.insertTemplate !== null
      ? [
          {
            id: "insert-template",
            label: "Insert template…",
            icon: <LayoutTemplateIcon />,
            keepOpen: true,
            run: () => goTo("insert-template"),
          },
        ]
      : []),
    {
      id: "search-vault",
      label: "Search across the vault…",
      binding: "open-search",
      icon: <SearchIcon />,
      keepOpen: true,
      run: () => goTo("search"),
    },
    ...(actions.listHeadings !== null
      ? [
          {
            id: "go-to-heading",
            label: "Go to heading…",
            binding: "open-headings" as const,
            icon: <HeadingIcon />,
            keepOpen: true,
            run: () => goTo("headings"),
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
    ...(actions.pin !== null
      ? [
          {
            id: "pin-note",
            label: actions.pin.pinned ? "Unpin note" : "Pin note",
            icon: actions.pin.pinned ? <PinOffIcon /> : <PinIcon />,
            run: () => actions.pin?.toggle(),
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
              setMoveSubject(openNotePath);
              goTo("move-to-folder");
            },
          },
        ]
      : []),
    {
      id: "threads",
      label: "Actions",
      icon: <MessagesSquareIcon />,
      keepOpen: true,
      run: () => goTo("threads"),
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
      id: "problems",
      label: "Problems",
      icon: <TriangleAlertIcon />,
      keepOpen: true,
      run: () => goTo("problems"),
    },
    {
      id: "keyboard-shortcuts",
      label: "Keyboard shortcuts",
      icon: <KeyboardIcon />,
      keepOpen: true,
      run: () => goTo("shortcuts"),
    },
    {
      id: "settings",
      label: "Settings",
      binding: "open-settings",
      icon: <SettingsIcon />,
      run: () => actions.openSettings(),
    },
  ];

  const shell = { open, onOpenChange, query, onQueryChange: setQuery };

  if (page === "headings") {
    const rows = actions.listHeadings === null ? [] : actions.listHeadings();
    const visible = rows.filter((row) => matchesQuery(row.title, query));
    return (
      <PalettePage
        {...shell}
        title="Go to heading"
        description="Jump to a heading in this note"
        placeholder="Go to heading…"
      >
        <CommandEmpty>
          {actions.listHeadings === null
            ? "Open a note to jump to its headings."
            : rows.length === 0
              ? "This note has no headings."
              : "No heading matches."}
        </CommandEmpty>
        {visible.length > 0 ? (
          <CommandGroup heading="Headings">
            {visible.map((row) => (
              <CommandItem
                key={row.id}
                value={row.id}
                onSelect={() => run(() => actions.goToHeading(row))}
              >
                <HeadingIcon />
                <span
                  className="truncate"
                  style={{ paddingLeft: `${String(12 * (row.depth - 1))}px` }}
                >
                  {row.title}
                </span>
                <span className="ml-auto pl-3 text-xs text-muted-foreground">H{row.depth}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </PalettePage>
    );
  }

  if (page === "problems") {
    return (
      <ProblemsPage
        {...shell}
        onOpenNote={(path) => run(() => actions.openNote(path))}
        onOpenLink={(sourcePath, target) => run(() => actions.openProblemLink(sourcePath, target))}
      />
    );
  }

  if (page === "shortcuts") {
    return <ShortcutsPage {...shell} modifier={modifier} onPick={close} />;
  }

  if (page === "search") {
    return (
      <SearchPage
        {...shell}
        onOpenMatch={(match, needle) => run(() => actions.openMatch(match, needle))}
        onReplaceAll={actions.replaceAll}
      />
    );
  }

  if (page === "threads") {
    const visibleThreads = threads
      .filter(
        (thread) =>
          matchesQuery(threadRowLabel(thread), query) ||
          matchesQuery(thread.originDocPath ?? "", query),
      )
      .slice(0, 30);
    return (
      <PalettePage
        {...shell}
        title="Actions"
        description="Open a recent action in the panel"
        placeholder="Find an action…"
      >
        <CommandEmpty>No actions yet.</CommandEmpty>
        <CommandGroup heading="Recent">
          {visibleThreads.map((thread) => (
            <CommandItem key={thread.id} onSelect={() => run(() => actions.openThread(thread.id))}>
              <MessagesSquareIcon />
              <span className="truncate">{threadRowLabel(thread)}</span>
              <span className="ml-auto truncate pl-3 text-xs text-muted-foreground">
                {threadRowDetail(thread)}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </PalettePage>
    );
  }

  if (page === "new-note-template") {
    return (
      <PalettePage
        {...shell}
        title="New note from template"
        description="Pick the template the new note starts from"
        placeholder="New note from which template?"
      >
        <TemplateRows
          templatePaths={templatePaths}
          query={query}
          onPick={(path) => run(() => actions.newNoteFromTemplate(path))}
        />
      </PalettePage>
    );
  }

  if (page === "insert-template") {
    return (
      <PalettePage
        {...shell}
        title="Insert template"
        description="Pick the template to insert at the cursor"
        placeholder="Insert which template?"
      >
        <TemplateRows
          templatePaths={templatePaths}
          query={query}
          onPick={(path) => run(() => actions.insertTemplate?.(path))}
        />
      </PalettePage>
    );
  }

  if (page === "new-note-folder") {
    return (
      <FolderPage
        {...shell}
        title="New note in folder"
        description="Pick the folder for the new note"
        placeholder="New note in which folder?"
        empty="No matching folder."
        folders={["", ...folders].filter((dir) => dir === "" || matchesQuery(dir, query))}
        onPick={(dir) => run(() => actions.newNote(dir))}
      />
    );
  }

  if (page === "move-to-folder" && moveSubject !== null) {
    const subject = moveSubject;
    return (
      <FolderPage
        {...shell}
        title={`Move ${basenamePath(subject)}`}
        description="Pick the folder to move it into"
        placeholder="Move to which folder?"
        empty="No folder it can move to."
        folders={["", ...folders].filter(
          (dir) => planMove(subject, dir).ok && (dir === "" || matchesQuery(dir, query)),
        )}
        onPick={(dir) => run(() => actions.moveNote(subject, dir))}
      />
    );
  }

  const quickOpen = page === "notes";
  const visibleCommands = quickOpen
    ? []
    : commands.filter((command) => matchesQuery(command.label, query));

  return (
    <PalettePage
      {...shell}
      title={quickOpen ? "Open a note" : "Command palette"}
      description={quickOpen ? "Jump to a note by name" : "Open a note or run a command"}
      placeholder={quickOpen ? "Open a note…" : "Search notes or commands…"}
    >
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
              {command.binding !== undefined ? (
                <CommandShortcut>{bindingFor(command.binding, modifier)}</CommandShortcut>
              ) : null}
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}
    </PalettePage>
  );
}
