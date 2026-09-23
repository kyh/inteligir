import {
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandShortcut,
} from "@repo/ui/components/command";
import { cn } from "@repo/ui/lib/cn";
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
import { orpc } from "../api";
import { threadActivity, THREAD_ACTIVITY_LABELS } from "../thread-activity";
import { vaultFolders } from "../vault-hooks";
import { listedNotePaths, NOTE_SEARCH_LIMIT, searchNotesByFilename } from "./note-search";
import type { NoteSearchHit } from "./note-search";
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

// the open note and every verb that needs one, so no row can be offered without its note
export interface PaletteNote {
  path: string;
  pinned: boolean;
  togglePin: () => void;
  findInNote: () => void;
  insertTemplate: (templatePath: string) => void;
  exportPdf: () => void;
  // the outline, walked when the page asks
  listHeadings: () => readonly HeadingItem[];
}

export interface PaletteActions {
  openNote: (path: string) => void;
  newNote: (parentDir: string) => void;
  newNoteFromTemplate: (templatePath: string) => void;
  openDailyNote: () => void;
  openThread: (threadId: string) => void;
  syncNow: () => void;
  openSettings: () => void;
  openDeletedNotes: () => void;
  note: PaletteNote | null;
  moveNote: (path: string, toDir: string) => void;
  openMatch: (match: VaultMatchWire, query: string) => void;
  // settles when the run is over, cancelled or declined included; the palette shows it running
  replaceAll: (request: VaultReplaceRequest, port: ReplaceProgressPort) => Promise<void>;
  goToHeading: (heading: HeadingItem) => void;
  // opens the source note and lands on the link written against `target`
  openProblemLink: (sourcePath: string, target: string) => void;
}

// the pages an entry point opens onto; ⌘P is the one that opens the root, and a move names the
// entry it moves
export type PaletteEntry =
  | { page: "root" | "search" | "headings" }
  | { page: "move-to-folder"; subject: string };

// One channel for every way the palette opens. The workspace bumps `nonce` per open and keys the
// palette on it, so each open mounts fresh and no state from the last open needs resetting.
export type PaletteRequest = PaletteEntry & { nonce: number };

type Page =
  | PaletteEntry
  | {
      page:
        | "new-note-folder"
        | "new-note-template"
        | "insert-template"
        | "threads"
        | "shortcuts"
        | "problems";
    };

// what the one dialog says around a page
interface PageChrome {
  title: string;
  description: string;
  placeholder: string;
  wide?: boolean;
}

const PAGE_CHROME: Record<Exclude<Page["page"], "move-to-folder">, PageChrome> = {
  headings: {
    description: "Jump to a heading in this note",
    placeholder: "Go to heading…",
    title: "Go to heading",
  },
  "insert-template": {
    description: "Pick the template to insert at the cursor",
    placeholder: "Insert which template?",
    title: "Insert template",
  },
  "new-note-folder": {
    description: "Pick the folder for the new note",
    placeholder: "New note in which folder?",
    title: "New note in folder",
  },
  "new-note-template": {
    description: "Pick the template the new note starts from",
    placeholder: "New note from which template?",
    title: "New note from template",
  },
  problems: {
    description: "What the vault's links cannot resolve",
    placeholder: "Filter problems…",
    title: "Problems",
    wide: true,
  },
  root: {
    description: "Open a note or run a command",
    placeholder: "Search notes or commands…",
    title: "Command palette",
  },
  search: {
    description: "Every match, with the line it sits on",
    placeholder: "Search across the vault…",
    title: "Search the vault",
    wide: true,
  },
  shortcuts: {
    description: "Every binding, spelled for this keyboard",
    placeholder: "Filter shortcuts…",
    title: "Keyboard shortcuts",
  },
  threads: {
    description: "Open a recent action in the panel",
    placeholder: "Find an action…",
    title: "Actions",
  },
};

const pageChrome = (page: Page): PageChrome =>
  page.page === "move-to-folder"
    ? {
        description: "Pick the folder to move it into",
        placeholder: "Move to which folder?",
        title: `Move ${basenamePath(page.subject)}`,
      }
    : PAGE_CHROME[page.page];

export interface CommandPaletteProps {
  open: boolean;
  request: PaletteRequest;
  // how a binding is spelled; the workspace passes the one it listens with
  modifier?: ShortcutModifier;
  onOpenChange: (open: boolean) => void;
  entries: readonly VaultEntry[];
  threads: readonly Thread[];
  canSync: boolean;
  actions: PaletteActions;
}

const headingsEmptySentence = (note: PaletteNote | null, rowCount: number): string => {
  if (note === null) {
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

const noteCommands = (note: PaletteNote, goTo: (next: Page) => void): StaticCommand[] => [
  {
    binding: "find-in-note",
    icon: <TextSearchIcon />,
    id: "find-in-note",
    label: "Find in note",
    run: note.findInNote,
  },
  {
    icon: <LayoutTemplateIcon />,
    id: "insert-template",
    keepOpen: true,
    label: "Insert template…",
    run: () => {
      goTo({ page: "insert-template" });
    },
  },
  {
    binding: "open-headings",
    icon: <HeadingIcon />,
    id: "go-to-heading",
    keepOpen: true,
    label: "Go to heading…",
    run: () => {
      goTo({ page: "headings" });
    },
  },
  {
    icon: <PrinterIcon />,
    id: "export-pdf",
    label: "Export as PDF",
    run: note.exportPdf,
  },
  {
    icon: note.pinned ? <PinOffIcon /> : <PinIcon />,
    id: "pin-note",
    label: note.pinned ? "Unpin note" : "Pin note",
    run: note.togglePin,
  },
  {
    icon: <FolderInputIcon />,
    id: "move-note",
    keepOpen: true,
    label: "Move note to folder…",
    run: () => {
      goTo({ page: "move-to-folder", subject: note.path });
    },
  },
];

// Every verb the root page can run, in the order it lists them; the open note's are one block,
// absent with no note open.
const rootCommands = (
  actions: PaletteActions,
  canSync: boolean,
  goTo: (next: Page) => void,
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
      goTo({ page: "new-note-folder" });
    },
  },
  {
    icon: <LayoutTemplateIcon />,
    id: "new-note-from-template",
    keepOpen: true,
    label: "New note from template…",
    run: () => {
      goTo({ page: "new-note-template" });
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
  {
    icon: <SearchIcon />,
    id: "search-vault",
    keepOpen: true,
    label: "Search across the vault…",
    run: () => {
      goTo({ page: "search" });
    },
  },
  ...(actions.note === null ? [] : noteCommands(actions.note, goTo)),
  {
    icon: <MessagesSquareIcon />,
    id: "threads",
    keepOpen: true,
    label: "Actions",
    run: () => {
      goTo({ page: "threads" });
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
      goTo({ page: "problems" });
    },
  },
  {
    icon: <KeyboardIcon />,
    id: "keyboard-shortcuts",
    keepOpen: true,
    label: "Keyboard shortcuts",
    run: () => {
      goTo({ page: "shortcuts" });
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
  canSync,
  actions,
}: CommandPaletteProps) => {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<Page>(request);
  const settledQuery = useDebounced(query, SEARCH_DEBOUNCE_MS);

  // Under the knowledge family, so the bus's sweep refreshes it; the filename fallback is derived
  // from the listing on every render, so nothing the index cannot answer is cached. A superseded
  // read is aborted by the cache itself: the key's last observer moving on cancels a fetch that
  // consumed its signal.
  const asksIndex = settledQuery.trim() !== "";
  const indexQuery = useQuery({
    ...orpc.knowledge.search.queryOptions({
      input: { limit: NOTE_SEARCH_LIMIT, q: settledQuery },
    }),
    enabled: open && page.page === "root" && asksIndex,
    placeholderData: (previous) => previous,
  });
  // an error leaves no data, so a refusing index falls back like an empty one
  const indexHits = asksIndex ? (indexQuery.data?.results ?? []) : [];
  const noteHits: NoteSearchHit[] =
    indexHits.length > 0
      ? indexHits.map((result) => ({
          path: result.path,
          title: result.title === "" ? null : result.title,
        }))
      : searchNotesByFilename(settledQuery, listedNotePaths(entries));

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
  const handleReplaceAll = actions.replaceAll;

  const body = (): React.ReactElement => {
    switch (page.page) {
      case "root": {
        const visibleCommands = rootCommands(actions, canSync, goTo).filter((command) =>
          matchesQuery(command.label, query),
        );
        return (
          <PalettePage>
            <CommandEmpty>Nothing matches.</CommandEmpty>
            {noteHits.length > 0 ? (
              <CommandGroup heading="Notes">
                {noteHits.map((hit) => (
                  <CommandItem
                    key={hit.path}
                    action={hit.title ?? hit.path}
                    onSelect={() => {
                      run(() => {
                        actions.openNote(hit.path);
                      });
                    }}
                  >
                    <FileTextIcon />
                    <span className="truncate">{hit.title ?? hit.path}</span>
                    {hit.title === null ? null : (
                      <span className="ml-auto truncate pl-3 text-body text-muted-foreground">
                        {hit.path}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {visibleCommands.length > 0 ? (
              <CommandGroup heading="Commands">
                {visibleCommands.map((command) => (
                  <CommandItem
                    key={command.id}
                    action={command.label}
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
                      <CommandShortcut keys={bindingFor(command.binding, modifier) ?? ""} />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </PalettePage>
        );
      }
      case "headings": {
        const { note } = actions;
        const outline = note === null ? [] : note.listHeadings();
        const visible = outline.filter((row) => matchesQuery(row.title, query));
        return (
          <PalettePage>
            <CommandEmpty>{headingsEmptySentence(note, outline.length)}</CommandEmpty>
            {visible.length > 0 ? (
              <CommandGroup heading="Headings">
                {visible.map((row) => (
                  <CommandItem
                    key={row.id}
                    action={row.title}
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
                    <span className="ml-auto pl-3 text-body text-muted-foreground">
                      H{row.depth}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </PalettePage>
        );
      }
      case "problems": {
        return (
          <ProblemsPage
            open={open}
            query={query}
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
      case "shortcuts": {
        return <ShortcutsPage query={query} modifier={modifier} onPick={close} />;
      }
      case "search": {
        return (
          <SearchPage
            open={open}
            query={query}
            onOpenMatch={(match, needle) => {
              run(() => {
                actions.openMatch(match, needle);
              });
            }}
            onReplaceAll={handleReplaceAll}
          />
        );
      }
      case "threads": {
        const visibleThreads = threads
          .filter(
            (thread) =>
              matchesQuery(threadRowLabel(thread), query) ||
              matchesQuery(thread.originDocPath ?? "", query),
          )
          .slice(0, 30);
        return (
          <PalettePage>
            <CommandEmpty>No actions yet.</CommandEmpty>
            <CommandGroup heading="Recent">
              {visibleThreads.map((thread) => (
                <CommandItem
                  key={thread.id}
                  action={threadRowLabel(thread)}
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
      case "new-note-template": {
        return (
          <PalettePage>
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
      case "insert-template": {
        return (
          <PalettePage>
            <TemplateRows
              templatePaths={templatePaths}
              query={query}
              onPick={(path) => {
                run(() => {
                  actions.note?.insertTemplate(path);
                });
              }}
            />
          </PalettePage>
        );
      }
      case "new-note-folder": {
        return (
          <FolderPage
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
      case "move-to-folder": {
        const { subject } = page;
        return (
          <FolderPage
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
      default: {
        const exhaustive: never = page;
        return exhaustive;
      }
    }
  };

  // One dialog, one field and one hint strip for every page, so a page switch keeps the backdrop
  // still and the caret in the field; only the body under the field changes.
  const chrome = pageChrome(page);
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={chrome.title}
      description={chrome.description}
      className={cn(chrome.wide === true && "max-w-[min(100%-2rem,720px)]")}
    >
      <CommandInput
        placeholder={chrome.placeholder}
        value={query}
        onValueChange={setQuery}
        aria-label={chrome.title}
      />
      {body()}
      <CommandFooter />
    </CommandDialog>
  );
};
