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
import { platformShortcutModifier } from "@repo/editor/hotkey-spelling";
import type { ShortcutModifier } from "@repo/editor/hotkey-spelling";
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
import { bindingFor } from "../global-shortcuts";
import type { GlobalShortcutAction } from "../global-shortcuts";
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

// the pages an entry point opens onto; ⌘P is the one that opens the root
export type PaletteEntryPage = "root" | "search" | "headings" | "move-to-folder";

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

const headingsEmptySentence = (
  listHeadings: PaletteActions["listHeadings"],
  rowCount: number,
): string => {
  if (listHeadings === null) {
    return "Open a note to jump to its headings.";
  }
  return rowCount === 0 ? "This note has no headings." : "No heading matches.";
};

const threadRowLabel = (thread: Thread): string => thread.title ?? "Action";

const threadRowDetail = (thread: Thread): string => {
  const activity = THREAD_ACTIVITY_LABELS[threadActivity(thread)];
  return thread.originDocPath === null ? activity : `${activity} · ${thread.originDocPath}`;
};

interface StaticCommand {
  id: string;
  label: string;
  // the row's binding comes from the global table, so the palette never spells a chord itself
  binding?: GlobalShortcutAction;
  icon: React.ReactNode;
  keepOpen?: boolean;
  run: () => void;
}

// Every verb the root page can run, in the order it lists them. A verb the open note does not
// have (no pin, no outline) is simply absent.
const rootCommands = (
  actions: PaletteActions,
  canSync: boolean,
  openNotePath: string | null | undefined,
  goTo: (next: Page) => void,
  setMoveSubject: (path: string | null) => void,
): StaticCommand[] => [
  {
    icon: <FilePlusIcon />,
    id: "new-note",
    label: "New note",
    run: () => {
      actions.newNote("");
    },
  },
  {
    icon: <FolderIcon />,
    id: "new-note-in-folder",
    keepOpen: true,
    label: "New note in folder…",
    run: () => {
      goTo("new-note-folder");
    },
  },
  {
    icon: <LayoutTemplateIcon />,
    id: "new-note-from-template",
    keepOpen: true,
    label: "New note from template…",
    run: () => {
      goTo("new-note-template");
    },
  },
  {
    binding: "open-daily-note",
    icon: <CalendarIcon />,
    id: "daily-note",
    label: "Daily note",
    run: () => {
      actions.openDailyNote();
    },
  },
  ...(actions.findInNote === null
    ? []
    : [
        {
          binding: "find-in-note" as const,
          icon: <TextSearchIcon />,
          id: "find-in-note",
          label: "Find in note",
          run: () => actions.findInNote?.(),
        },
      ]),
  ...(actions.insertTemplate === null
    ? []
    : [
        {
          icon: <LayoutTemplateIcon />,
          id: "insert-template",
          keepOpen: true,
          label: "Insert template…",
          run: () => {
            goTo("insert-template");
          },
        },
      ]),
  {
    icon: <SearchIcon />,
    id: "search-vault",
    keepOpen: true,
    label: "Search across the vault…",
    run: () => {
      goTo("search");
    },
  },
  ...(actions.listHeadings === null
    ? []
    : [
        {
          binding: "open-headings" as const,
          icon: <HeadingIcon />,
          id: "go-to-heading",
          keepOpen: true,
          label: "Go to heading…",
          run: () => {
            goTo("headings");
          },
        },
      ]),
  ...(actions.exportPdf === null
    ? []
    : [
        {
          icon: <PrinterIcon />,
          id: "export-pdf",
          label: "Export as PDF",
          run: () => actions.exportPdf?.(),
        },
      ]),
  ...(actions.pin === null
    ? []
    : [
        {
          icon: actions.pin.pinned ? <PinOffIcon /> : <PinIcon />,
          id: "pin-note",
          label: actions.pin.pinned ? "Unpin note" : "Pin note",
          run: () => actions.pin?.toggle(),
        },
      ]),
  ...(openNotePath === null
    ? []
    : [
        {
          icon: <FolderInputIcon />,
          id: "move-note",
          keepOpen: true,
          label: "Move note to folder…",
          run: () => {
            setMoveSubject(openNotePath ?? null);
            goTo("move-to-folder");
          },
        },
      ]),
  {
    icon: <MessagesSquareIcon />,
    id: "threads",
    keepOpen: true,
    label: "Actions",
    run: () => {
      goTo("threads");
    },
  },
  ...(canSync
    ? [
        {
          icon: <RefreshCwIcon />,
          id: "sync-now",
          label: "Sync now",
          run: () => {
            actions.syncNow();
          },
        },
      ]
    : []),
  {
    icon: <ArchiveRestoreIcon />,
    id: "deleted-notes",
    label: "Deleted notes",
    run: () => {
      actions.openDeletedNotes();
    },
  },
  {
    icon: <TriangleAlertIcon />,
    id: "problems",
    keepOpen: true,
    label: "Problems",
    run: () => {
      goTo("problems");
    },
  },
  {
    icon: <KeyboardIcon />,
    id: "keyboard-shortcuts",
    keepOpen: true,
    label: "Keyboard shortcuts",
    run: () => {
      goTo("shortcuts");
    },
  },
  {
    binding: "open-settings",
    icon: <SettingsIcon />,
    id: "settings",
    label: "Settings",
    run: () => {
      actions.openSettings();
    },
  },
];

export const CommandPalette = ({
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
}: CommandPaletteProps) => {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<Page>(request.page);
  // the entry a move page is for: the request's, or the open note the root row named
  const [moveSubject, setMoveSubject] = useState<string | null>(request.subject ?? null);
  const settledQuery = useDebounced(query, SEARCH_DEBOUNCE_MS);

  // a source, not a route: it merges the filename fallback the index cannot answer. A superseded
  // read is aborted by the cache itself: the key's last observer moving on cancels a fetch that
  // consumed its signal.
  /* oxlint-disable sort-keys -- TanStack infers `placeholderData`'s parameter from the data
     type, which only exists once queryKey/queryFn are above it; sorted, `previous` is `{}`. */
  const noteHitsQuery = useQuery({
    queryKey: ["palette", "note-hits", settledQuery],
    queryFn: async ({ signal }) =>
      await searchSource(settledQuery, signal).catch((): NoteSearchHit[] => []),
    enabled: open && page === "root",
    placeholderData: (previous) => previous,
  });
  const noteHits = noteHitsQuery.data ?? [];

  const close = (): void => {
    onOpenChange(false);
  };
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

  const commands = rootCommands(actions, canSync, openNotePath, goTo, setMoveSubject);

  const shell = { onOpenChange, onQueryChange: setQuery, open, query };
  const handleReplaceAll = actions.replaceAll;

  // Each entry point is its own page; the root list below is what a plain open shows.
  const subPage = (): React.ReactElement | null => {
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
          <CommandEmpty>{headingsEmptySentence(actions.listHeadings, rows.length)}</CommandEmpty>
          {visible.length > 0 ? (
            <CommandGroup heading="Headings">
              {visible.map((row) => (
                <CommandItem
                  key={row.id}
                  value={row.id}
                  onSelect={() => {
                    run(() => {
                      actions.goToHeading(row);
                    });
                  }}
                >
                  <HeadingIcon />
                  <span
                    className="truncate"
                    style={{ paddingLeft: `${String(12 * (row.depth - 1))}px` }}
                  >
                    {row.title}
                  </span>
                  <span className="ml-auto pl-3 text-body text-muted-foreground">H{row.depth}</span>
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
          onOpenNote={(path) => {
            run(() => {
              actions.openNote(path);
            });
          }}
          onOpenLink={(sourcePath, target) => {
            run(() => {
              actions.openProblemLink(sourcePath, target);
            });
          }}
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
          onOpenMatch={(match, needle) => {
            run(() => {
              actions.openMatch(match, needle);
            });
          }}
          onReplaceAll={handleReplaceAll}
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
              <CommandItem
                key={thread.id}
                onSelect={() => {
                  run(() => {
                    actions.openThread(thread.id);
                  });
                }}
              >
                <MessagesSquareIcon />
                <span className="truncate">{threadRowLabel(thread)}</span>
                <span className="ml-auto truncate pl-3 text-body text-muted-foreground">
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
            onPick={(path) => {
              run(() => {
                actions.newNoteFromTemplate(path);
              });
            }}
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
            onPick={(path) => {
              run(() => actions.insertTemplate?.(path));
            }}
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
          onPick={(dir) => {
            run(() => {
              actions.newNote(dir);
            });
          }}
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
          onPick={(dir) => {
            run(() => {
              actions.moveNote(subject, dir);
            });
          }}
        />
      );
    }
    return null;
  };

  const paged = subPage();
  if (paged !== null) {
    return paged;
  }

  const visibleCommands = commands.filter((command) => matchesQuery(command.label, query));

  return (
    <PalettePage
      {...shell}
      title="Command palette"
      description="Open a note or run a command"
      placeholder="Search notes or commands…"
    >
      <CommandEmpty>Nothing matches.</CommandEmpty>
      {noteHits.length > 0 ? (
        <CommandGroup heading="Notes">
          {noteHits.map((hit) => (
            <CommandItem
              key={hit.path}
              onSelect={() => {
                run(() => {
                  actions.openNote(hit.path);
                });
              }}
            >
              <FileTextIcon />
              <span className="truncate">
                {hit.title !== undefined && hit.title !== "" ? hit.title : hit.path}
              </span>
              {hit.title !== undefined && hit.title !== "" ? (
                <span className="ml-auto truncate pl-3 text-body text-muted-foreground">
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
              onSelect={() => {
                if (command.keepOpen === true) {
                  command.run();
                } else {
                  run(command.run);
                }
              }}
            >
              {command.icon}
              {command.label}
              {command.binding === undefined ? null : (
                <CommandShortcut>{bindingFor(command.binding, modifier)}</CommandShortcut>
              )}
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}
    </PalettePage>
  );
};
