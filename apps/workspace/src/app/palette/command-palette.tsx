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
import type { VaultMatchWire } from "@repo/contract/local/knowledge/knowledge-schema";
import type { Thread } from "@repo/contract/local/threads/threads-schema";
import type { VaultEntry } from "@repo/contract/local/vault/vault-schema";
import type { TextMatchOptions } from "@repo/notes/knowledge/text-matches";
import { basenamePath } from "@repo/notes/knowledge/vault-path";
import { isWebUrl } from "@repo/notes/items/item-url";
import { platformShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import type { ShortcutModifier } from "@repo/ui/lib/hotkey-spelling";
import type { HeadingItem } from "@repo/editor/toc";
import { useQuery } from "@tanstack/react-query";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  BookmarkPlusIcon,
  ExternalLinkIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderIcon,
  FolderInputIcon,
  HeadingIcon,
  ImportIcon,
  KeyboardIcon,
  LibraryIcon,
  MessagesSquareIcon,
  PaperclipIcon,
  PinIcon,
  PinOffIcon,
  RefreshCwIcon,
  RotateCwIcon,
  SearchIcon,
  SettingsIcon,
  PrinterIcon,
  SparklesIcon,
  TextSearchIcon,
} from "lucide-react";
import { useState } from "react";
import { bindingCapsFor } from "../global-shortcuts";
import type { GlobalShortcutAction } from "../global-shortcuts";
import { TIDY_LABEL } from "../library/tidy-library";
import { planMove } from "../sidebar/tree-ops";
import { orpc } from "../api";
import { vaultFolders } from "../vault-hooks";
import { listedNotePaths, NOTE_SEARCH_LIMIT, searchNotesByFilename } from "./note-search";
import type { NoteSearchHit } from "./note-search";
import {
  FolderPage,
  matchesQuery,
  PalettePage,
  SEARCH_DEBOUNCE_MS,
  useDebounced,
} from "./palette-page";
import { SaveLinkPage } from "./save-link-page";
import { SearchPage } from "./search-page";
import { ShortcutsPage } from "./shortcuts-page";
import { ThreadsPage } from "./threads-page";

// a saved page's own verbs, offered only for an item that came from a web address
export interface PaletteSource {
  keepCopy: () => void;
  refresh: () => void;
  openOriginal: () => void;
}

// the open item and every verb that needs one, so no row can be offered without its item
export interface PaletteNote {
  path: string;
  pinned: boolean;
  togglePin: () => void;
  findInNote: () => void;
  exportPdf: () => void;
  // the outline, walked once as its page opens
  listHeadings: () => readonly HeadingItem[];
  source: PaletteSource | null;
}

export interface PaletteActions {
  openNote: (path: string) => void;
  // a link the field holds, saved into the scope the library shows
  saveLink: (url: string) => void;
  addFiles: () => void;
  // the grid filtered by what the field holds: ⌘P stays the one search field
  showResults: (q: string) => void;
  startTidy: () => void;
  importRaindrop: () => void;
  newNote: (parentDir: string) => void;
  openThread: (threadId: string) => void;
  syncNow: () => void;
  openSettings: () => void;
  openDeletedNotes: () => void;
  note: PaletteNote | null;
  moveItems: (paths: readonly [string, ...string[]], toDir: string) => void;
  // `needle` and `options` are the search the row was listed by, so its ordinal counts among them
  openMatch: (match: VaultMatchWire, needle: string, options: TextMatchOptions) => void;
  goToHeading: (heading: HeadingItem) => void;
}

// the pages an entry point opens onto; ⌘P is the one that opens the root, a move names the entry
// it moves, and the headings page carries the outline its opener walked. the workspace sits
// outside the Plate provider and cannot subscribe to the document, so the outline is a snapshot
// taken as the page opens, never a walk during render.
export type PaletteEntry =
  | { page: "root" | "search" | "save-link" }
  | { page: "headings"; outline: readonly HeadingItem[] }
  | { page: "move-to-folder"; subjects: readonly [string, ...string[]] };

// One channel for every way the palette opens. The workspace bumps `nonce` per open and keys the
// palette on it, so each open mounts fresh and no state from the last open needs resetting.
export type PaletteRequest = PaletteEntry & { nonce: number };

type Page = PaletteEntry | { page: "new-note-folder" | "threads" | "shortcuts" };

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
  "new-note-folder": {
    description: "Pick the folder for the new note",
    placeholder: "New note in which folder?",
    title: "New note in folder",
  },
  root: {
    description: "Open an item or run a command",
    placeholder: "Search your library or run a command…",
    title: "Command palette",
  },
  "save-link": {
    description: "Save a link to your library",
    placeholder: "Paste a link to save…",
    title: "Save link",
  },
  search: {
    description: "Every match, with the line it sits on",
    placeholder: "Search inside every item…",
    title: "Search inside items",
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
        title:
          page.subjects.length === 1
            ? `Move ${basenamePath(page.subjects[0])}`
            : `Move ${String(page.subjects.length)} items`,
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
    return "Open an item to jump to its headings.";
  }
  return rowCount === 0 ? "This item has no headings." : "No heading matches.";
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

// the same three calls Info and the card's menu make
const sourceCommands = (source: PaletteSource): StaticCommand[] => [
  {
    icon: <ExternalLinkIcon />,
    id: "open-original",
    label: "Open original",
    run: source.openOriginal,
  },
  {
    icon: <ArchiveIcon />,
    id: "keep-copy",
    label: "Keep a copy of the page",
    run: source.keepCopy,
  },
  {
    icon: <RotateCwIcon />,
    id: "refresh-from-page",
    label: "Refresh from the page",
    run: source.refresh,
  },
];

const noteCommands = (note: PaletteNote, goTo: (next: Page) => void): StaticCommand[] => [
  {
    binding: "find-in-note",
    icon: <TextSearchIcon />,
    id: "find-in-note",
    label: "Find in note",
    run: note.findInNote,
  },
  {
    binding: "open-headings",
    icon: <HeadingIcon />,
    id: "go-to-heading",
    keepOpen: true,
    label: "Go to heading…",
    run: () => {
      goTo({ outline: note.listHeadings(), page: "headings" });
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
    label: note.pinned ? "Unpin" : "Pin",
    run: note.togglePin,
  },
  {
    icon: <FolderInputIcon />,
    id: "move-note",
    keepOpen: true,
    label: "Move to folder…",
    run: () => {
      goTo({ page: "move-to-folder", subjects: [note.path] });
    },
  },
  ...(note.source === null ? [] : sourceCommands(note.source)),
];

// Every verb the root page can run, in the order it lists them; the open note's are one block,
// absent with no note open.
const rootCommands = (
  actions: PaletteActions,
  canSync: boolean,
  goTo: (next: Page) => void,
): StaticCommand[] => [
  {
    icon: <BookmarkPlusIcon />,
    id: "save-link",
    keepOpen: true,
    label: "Save link…",
    run: () => {
      goTo({ page: "save-link" });
    },
  },
  {
    icon: <PaperclipIcon />,
    id: "add-files",
    label: "Add files…",
    run: () => {
      actions.addFiles();
    },
  },
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
    icon: <SearchIcon />,
    id: "search-vault",
    keepOpen: true,
    label: "Search inside every item…",
    run: () => {
      goTo({ page: "search" });
    },
  },
  {
    icon: <SparklesIcon />,
    id: "tidy-library",
    label: TIDY_LABEL,
    run: () => {
      actions.startTidy();
    },
  },
  {
    icon: <ImportIcon />,
    id: "import-raindrop",
    label: "Import from Raindrop…",
    run: () => {
      actions.importRaindrop();
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
    label: "Deleted",
    run: () => {
      actions.openDeletedNotes();
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
    // a retry holds the last query's hits on screen for seconds, where a pick opens a note that
    // does not match the box
    retry: false,
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

  const body = (): React.ReactElement => {
    switch (page.page) {
      case "root": {
        const visibleCommands = rootCommands(actions, canSync, goTo).filter((command) =>
          matchesQuery(command.label, query),
        );
        const typedLink = query.trim();
        return (
          <PalettePage>
            <CommandEmpty>Nothing matches.</CommandEmpty>
            {isWebUrl(typedLink) ? (
              <CommandGroup heading="Link">
                <CommandItem
                  action="Save this link"
                  onSelect={() => {
                    run(() => {
                      actions.saveLink(typedLink);
                    });
                  }}
                >
                  <BookmarkPlusIcon />
                  Save this link
                  <span className="ml-auto truncate pl-3 text-body text-muted-foreground">
                    {typedLink}
                  </span>
                </CommandItem>
              </CommandGroup>
            ) : null}
            {noteHits.length > 0 || typedLink !== "" ? (
              <CommandGroup heading="Items">
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
                {typedLink === "" ? null : (
                  <CommandItem
                    action="Show all results in the library"
                    onSelect={() => {
                      run(() => {
                        actions.showResults(typedLink);
                      });
                    }}
                  >
                    <LibraryIcon />
                    Show all results in the library
                  </CommandItem>
                )}
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
                      <CommandShortcut caps={bindingCapsFor(command.binding, modifier)} />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </PalettePage>
        );
      }
      case "headings": {
        const { outline } = page;
        const visible = outline.filter((row) => matchesQuery(row.title, query));
        return (
          <PalettePage>
            <CommandEmpty>{headingsEmptySentence(actions.note, outline.length)}</CommandEmpty>
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
      case "shortcuts": {
        return <ShortcutsPage query={query} modifier={modifier} onPick={close} />;
      }
      case "search": {
        return (
          <SearchPage
            open={open}
            query={query}
            onOpenMatch={(match, needle, options) => {
              run(() => {
                actions.openMatch(match, needle, options);
              });
            }}
          />
        );
      }
      case "threads": {
        return (
          <ThreadsPage
            open={open}
            query={query}
            threads={threads}
            onOpenThread={(threadId) => {
              run(() => {
                actions.openThread(threadId);
              });
            }}
          />
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
      case "save-link": {
        return (
          <SaveLinkPage
            open={open}
            query={query}
            onSave={(url) => {
              run(() => {
                actions.saveLink(url);
              });
            }}
            onOpenItem={(path) => {
              run(() => {
                actions.openNote(path);
              });
            }}
          />
        );
      }
      case "move-to-folder": {
        const { subjects } = page;
        return (
          <FolderPage
            empty="No folder it can move to."
            folders={["", ...folders].filter(
              (dir) =>
                subjects.some((subject) => planMove(subject, dir).ok) &&
                (dir === "" || matchesQuery(dir, query)),
            )}
            onPick={(dir) => {
              run(() => {
                actions.moveItems(subjects, dir);
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
