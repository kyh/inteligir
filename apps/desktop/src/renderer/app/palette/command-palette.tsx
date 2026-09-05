// shouldFilter is off: the search source and matchesQuery are the filtering,
// not cmdk's heuristics.

import { Button } from "@repo/ui/components/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@repo/ui/components/command";
import { cn } from "@repo/ui/lib/utils";
import {
  KNOWLEDGE_MATCHES_DEFAULT_LIMIT,
  type KnowledgeMatchesResponse,
  type VaultMatchWire,
} from "@repo/api/local/knowledge/knowledge-schema";
import type { Thread } from "@repo/api/local/threads/threads-schema";
import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import {
  ArchiveRestoreIcon,
  CalendarIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderIcon,
  MessagesSquareIcon,
  RefreshCwIcon,
  SearchIcon,
  SettingsIcon,
  PrinterIcon,
  TextSearchIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { threadActivity, THREAD_ACTIVITY_LABELS } from "../thread-activity";
import type { MatchSource } from "./match-source";
import type { NoteSearchHit, NoteSearchSource } from "./note-search";
import type { VaultReplaceRequest } from "./vault-replace";

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
  openMatch: (match: VaultMatchWire, query: string) => void;
  replaceAll: (request: VaultReplaceRequest) => void;
}

// the pages a shortcut opens onto
export type PalettePage = "root" | "search";

export interface CommandPaletteProps {
  open: boolean;
  initialQuery?: string;
  initialPage?: PalettePage;
  onOpenChange: (open: boolean) => void;
  entries: readonly VaultEntry[];
  threads: readonly Thread[];
  searchSource: NoteSearchSource;
  matchSource: MatchSource;
  canSync: boolean;
  actions: PaletteActions;
}

type Page = PalettePage | "new-note-folder" | "threads";

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

interface MatchGroup {
  path: string;
  title: string;
  rows: VaultMatchWire[];
}

// one group per note, in the order the rows arrived (path order)
function groupMatches(matches: readonly VaultMatchWire[]): MatchGroup[] {
  const groups: MatchGroup[] = [];
  const byPath = new Map<string, MatchGroup>();
  for (const match of matches) {
    let group = byPath.get(match.path);
    if (group === undefined) {
      group = { path: match.path, title: match.title, rows: [] };
      byPath.set(match.path, group);
      groups.push(group);
    }
    group.rows.push(match);
  }
  return groups;
}

function SearchToggle({
  pressed,
  label,
  onToggle,
  children,
}: {
  pressed: boolean;
  label: string;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      onClick={onToggle}
      className={cn(
        "h-7 shrink-0 rounded-md px-1.5 text-xs font-medium text-muted-foreground hover:bg-hover hover:text-foreground",
        pressed && "bg-muted text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function CommandPalette({
  open,
  initialQuery = "",
  initialPage = "root",
  onOpenChange,
  entries,
  threads,
  searchSource,
  matchSource,
  canSync,
  actions,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<Page>("root");
  const [noteHits, setNoteHits] = useState<NoteSearchHit[]>([]);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [replacement, setReplacement] = useState("");
  const [matchResult, setMatchResult] = useState<KnowledgeMatchesResponse | null>(null);
  const [matchesFailed, setMatchesFailed] = useState(false);

  // Adjusted during render rather than in an effect, so the box is never
  // painted holding the previous opening's text.
  const [openedAs, setOpenedAs] = useState({ open: false, query: initialQuery, page: initialPage });
  if (openedAs.open !== open || openedAs.query !== initialQuery || openedAs.page !== initialPage) {
    setOpenedAs({ open, query: initialQuery, page: initialPage });
    if (open) {
      setQuery(initialQuery);
      setPage(initialPage);
      setMatchResult(null);
      setMatchesFailed(false);
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

  useEffect(() => {
    if (!open || page !== "search" || query === "") {
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = await matchSource(
            { q: query, caseSensitive, wholeWord, limit: KNOWLEDGE_MATCHES_DEFAULT_LIMIT },
            controller.signal,
          );
          if (!controller.signal.aborted) {
            setMatchResult(result);
            setMatchesFailed(false);
          }
        } catch {
          if (!controller.signal.aborted) {
            setMatchResult(null);
            setMatchesFailed(true);
          }
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, page, query, caseSensitive, wholeWord, matchSource]);

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
    {
      id: "search-vault",
      label: "Search across the vault…",
      shortcut: "⌘⇧F",
      icon: <SearchIcon />,
      keepOpen: true,
      run: () => {
        setQuery("");
        setPage("search");
      },
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

  if (page === "search") {
    const result = query === "" ? null : matchResult;
    const matches = result?.matches ?? [];
    const total = result?.total ?? 0;
    // a cut listing names some of the notes a replace would touch, not all of them
    const truncated = matches.length < total;
    const paths = [...new Set(matches.map((match) => match.path))];
    const canReplace = matches.length > 0 && !truncated;
    return (
      <CommandDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Search the vault"
        description="Every match, with the line it sits on"
        shouldFilter={false}
        className="sm:max-w-2xl"
      >
        <CommandInput
          placeholder="Search across the vault…"
          value={query}
          onValueChange={setQuery}
        />
        <div className="flex items-center gap-1 px-2 pt-1.5">
          <SearchToggle
            pressed={caseSensitive}
            label="Match case"
            onToggle={() => {
              setCaseSensitive((current) => !current);
            }}
          >
            Aa
          </SearchToggle>
          <SearchToggle
            pressed={wholeWord}
            label="Whole word"
            onToggle={() => {
              setWholeWord((current) => !current);
            }}
          >
            ab
          </SearchToggle>
          <input
            aria-label="Replace with"
            placeholder="Replace with…"
            value={replacement}
            onChange={(event) => {
              setReplacement(event.target.value);
            }}
            className="ml-1 h-7 min-w-0 flex-1 rounded-md bg-input/50 px-2 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Button
            variant="secondary"
            size="compact"
            disabled={!canReplace}
            onClick={() =>
              run(() =>
                actions.replaceAll({
                  needle: query,
                  replacement,
                  options: { caseSensitive, wholeWord },
                  paths,
                }),
              )
            }
          >
            Replace all
          </Button>
        </div>
        <CommandList className="max-h-96">
          <CommandEmpty>
            {query === ""
              ? "Type to search every note."
              : matchesFailed
                ? "Could not search just now."
                : result === null
                  ? "…"
                  : "No matches."}
          </CommandEmpty>
          {groupMatches(matches).map((group) => (
            <CommandGroup
              key={group.path}
              heading={group.title === "" ? group.path : `${group.title} · ${group.path}`}
            >
              {group.rows.map((row) => (
                <CommandItem
                  key={row.ordinal}
                  value={`${row.path}#${String(row.ordinal)}`}
                  onSelect={() => run(() => actions.openMatch(row, query))}
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-muted-foreground">{row.before}</span>
                    <mark className="rounded-[2px] bg-yellow-300/40 text-foreground dark:bg-yellow-500/25">
                      {row.text}
                    </mark>
                    <span className="text-muted-foreground">{row.after}</span>
                  </span>
                  <span className="ml-auto shrink-0 pl-3 text-xs text-muted-foreground tabular-nums">
                    {row.line}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
          {truncated ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {matches.length} of {total} matches shown. Narrow the search to replace.
            </p>
          ) : null}
        </CommandList>
      </CommandDialog>
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
