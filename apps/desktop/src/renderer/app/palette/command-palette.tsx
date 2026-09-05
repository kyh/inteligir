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
import { Tooltip } from "@repo/ui/components/tooltip";
import { cn } from "@repo/ui/lib/utils";
import {
  KNOWLEDGE_MATCHES_DEFAULT_LIMIT,
  KNOWLEDGE_PROBLEMS_DEFAULT_LIMIT,
  type KnowledgeMatchesResponse,
  type KnowledgeProblemsResponse,
  type VaultMatchWire,
} from "@repo/api/local/knowledge/knowledge-schema";
import type { Thread } from "@repo/api/local/threads/threads-schema";
import type { VaultEntry } from "@repo/api/local/vault/vault-schema";
import { basenamePath } from "@repo/notes/knowledge/vault-path";
import { docStem } from "@repo/notes/knowledge/doc-file";
import { isTemplatePath, TEMPLATES_FOLDER } from "@repo/notes/templates/placeholders";
import { EDITOR_SHORTCUTS } from "@repo/editor/editor-shortcuts";
import { FIND_BAR_SHORTCUTS } from "@repo/editor/find-bar";
import {
  platformShortcutModifier,
  spellHotkey,
  type ShortcutModifier,
} from "@repo/editor/hotkey-spelling";
import { MARK_SHORTCUTS } from "@repo/editor/mark-shortcuts";
import type { HeadingItem } from "@repo/editor/toc";
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
import { useCallback, useEffect, useState } from "react";
import {
  bindingFor,
  GLOBAL_SHORTCUTS,
  globalShortcutHotkey,
  type GlobalShortcutAction,
} from "../global-shortcuts";
import { planMove } from "../sidebar/tree-ops";
import { threadActivity, THREAD_ACTIVITY_LABELS } from "../thread-activity";
import type { MatchSource } from "./match-source";
import type { NoteSearchHit, NoteSearchSource } from "./note-search";
import type { ProblemSource } from "./problem-source";
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
  // exactly one of the two is offered while a note is open
  pinNote: (() => void) | null;
  unpinNote: (() => void) | null;
  openMatch: (match: VaultMatchWire, query: string) => void;
  // settles when the run is over, cancelled or declined included; the palette shows it running
  replaceAll: (request: VaultReplaceRequest, port: ReplaceProgressPort) => Promise<void>;
  // the open note's outline, walked when the page asks; absent with no note open
  listHeadings: (() => readonly HeadingItem[]) | null;
  goToHeading: (heading: HeadingItem) => void;
  // opens the source note and lands on the link written against `target`
  openProblemLink: (sourcePath: string, target: string) => void;
}

// the pages a shortcut opens onto; "notes" is the root with its commands folded away (⌘O)
export type PalettePage = "root" | "search" | "notes" | "headings";

export interface CommandPaletteProps {
  open: boolean;
  initialQuery?: string;
  initialPage?: PalettePage;
  // how a binding is spelled; the workspace passes the one it listens with
  modifier?: ShortcutModifier;
  onOpenChange: (open: boolean) => void;
  entries: readonly VaultEntry[];
  threads: readonly Thread[];
  searchSource: NoteSearchSource;
  matchSource: MatchSource;
  problemSource: ProblemSource;
  canSync: boolean;
  actions: PaletteActions;
  // the subject of the root "Move note to folder…" row; absent with no note open
  openNotePath?: string | null;
  // set at open, the palette starts on the folder page for this entry (the tree's Move to…)
  moveRequest?: string | null;
}

type Page =
  | PalettePage
  | "new-note-folder"
  | "new-note-template"
  | "insert-template"
  | "threads"
  | "move-to-folder"
  | "shortcuts"
  | "problems";

interface ShortcutRow {
  id: string;
  label: string;
  chord: string;
}

// a row opens `path`; with a `target` it lands on that link inside it
interface ProblemRow {
  id: string;
  label: string;
  detail: string;
  path: string;
  target?: string;
}

interface ProblemFamilyRows {
  id: string;
  heading: string;
  total: number;
  rows: ProblemRow[];
}

function problemFamilies(problems: KnowledgeProblemsResponse, query: string): ProblemFamilyRows[] {
  const families: ProblemFamilyRows[] = [
    {
      id: "unresolved",
      heading: "Unresolved links",
      total: problems.unresolvedLinks.total,
      rows: problems.unresolvedLinks.rows.map((row) => ({
        id: `unresolved ${row.sourcePath} ${row.target}`,
        label: `[[${row.target}]] in ${row.sourceTitle === "" ? row.sourcePath : row.sourceTitle}`,
        detail: `${row.sourcePath}:${String(row.line)}`,
        path: row.sourcePath,
        target: row.target,
      })),
    },
    {
      id: "embeds",
      heading: "Missing embeds",
      total: problems.missingEmbeds.total,
      rows: problems.missingEmbeds.rows.map((row) => ({
        id: `embed ${row.sourcePath} ${row.target}`,
        label: `${row.target} in ${row.sourceTitle === "" ? row.sourcePath : row.sourceTitle}`,
        detail: `${row.sourcePath}:${String(row.line)}`,
        path: row.sourcePath,
        target: row.target,
      })),
    },
    {
      id: "orphans",
      heading: "Orphans",
      total: problems.orphans.total,
      rows: problems.orphans.rows.map((row) => ({
        id: `orphan ${row.path}`,
        label: row.title === "" ? row.path : row.title,
        detail: row.path,
        path: row.path,
      })),
    },
    {
      id: "duplicates",
      heading: "Duplicate stems",
      total: problems.duplicateStems.total,
      rows: problems.duplicateStems.rows.flatMap((row) =>
        row.paths.map((path) => ({
          id: `duplicate ${path}`,
          label: row.stem,
          detail: path,
          path,
        })),
      ),
    },
  ];
  for (const family of families) {
    family.rows = family.rows.filter(
      (row) => matchesQuery(row.label, query) || matchesQuery(row.detail, query),
    );
  }
  return families.filter((family) => family.rows.length > 0);
}

function problemsHidden(problems: KnowledgeProblemsResponse): number {
  return [
    problems.unresolvedLinks,
    problems.missingEmbeds,
    problems.orphans,
    problems.duplicateStems,
  ].reduce((hidden, family) => hidden + (family.total - family.rows.length), 0);
}

// derived from the tables the listeners read, never a list of its own
function shortcutGroups(
  modifier: ShortcutModifier,
): readonly { heading: string; rows: ShortcutRow[] }[] {
  return [
    {
      heading: "Everywhere",
      rows: GLOBAL_SHORTCUTS.map((row) => ({
        id: row.action,
        label: row.label,
        chord: spellHotkey(globalShortcutHotkey(row), modifier),
      })),
    },
    {
      heading: "In the note",
      rows: [...MARK_SHORTCUTS, ...EDITOR_SHORTCUTS, ...FIND_BAR_SHORTCUTS].map((row) => ({
        id: row.action,
        label: row.label,
        chord: spellHotkey(row.hotkey, modifier),
      })),
    },
  ];
}

interface TemplatePageProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  placeholder: string;
  query: string;
  onQueryChange: (query: string) => void;
  templatePaths: readonly string[];
  onPick: (templatePath: string) => void;
}

// one page for both template commands: the list, the filter and the empty state are the same
// question, "which template?"; only the verb that follows differs.
function TemplatePage({
  open,
  onOpenChange,
  title,
  description,
  placeholder,
  query,
  onQueryChange,
  templatePaths,
  onPick,
}: TemplatePageProps) {
  const visible = templatePaths.filter((path) => matchesQuery(docStem(path), query));
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      shouldFilter={false}
    >
      <CommandInput placeholder={placeholder} value={query} onValueChange={onQueryChange} />
      <CommandList>
        <CommandEmpty>
          {templatePaths.length === 0
            ? `No templates yet — notes under ${TEMPLATES_FOLDER}/ appear here.`
            : "No matching template."}
        </CommandEmpty>
        <CommandGroup heading="Templates">
          {visible.map((path) => (
            <CommandItem key={path} onSelect={() => onPick(path)}>
              <LayoutTemplateIcon />
              <span className="truncate">{docStem(path)}</span>
              <span className="ml-auto truncate pl-3 text-xs text-muted-foreground">{path}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

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
  // the row's binding comes from the global table, so the palette never spells a chord itself
  binding?: GlobalShortcutAction;
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
    <Tooltip content={label}>
      <button
        type="button"
        aria-pressed={pressed}
        aria-label={label}
        onClick={onToggle}
        className={cn(
          "h-7 shrink-0 rounded-md px-1.5 text-xs font-medium text-muted-foreground hover:bg-hover hover:text-foreground",
          pressed && "bg-muted text-foreground",
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export function CommandPalette({
  open,
  initialQuery = "",
  initialPage = "root",
  modifier = platformShortcutModifier(),
  onOpenChange,
  entries,
  threads,
  searchSource,
  matchSource,
  problemSource,
  canSync,
  actions,
  openNotePath = null,
  moveRequest = null,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<Page>("root");
  const [moveSubject, setMoveSubject] = useState<string | null>(null);
  const [noteHits, setNoteHits] = useState<NoteSearchHit[]>([]);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [replacement, setReplacement] = useState("");
  // the run in flight: its counts, and the controller the Cancel button aborts
  const [replaceRun, setReplaceRun] = useState<{
    done: number;
    total: number;
    cancelled: boolean;
    controller: AbortController;
  } | null>(null);
  const [matchResult, setMatchResult] = useState<KnowledgeMatchesResponse | null>(null);
  const [matchesFailed, setMatchesFailed] = useState(false);
  const [problems, setProblems] = useState<KnowledgeProblemsResponse | null>(null);
  const [problemsFailed, setProblemsFailed] = useState(false);

  // Adjusted during render rather than in an effect, so the box is never
  // painted holding the previous opening's text.
  const [openedAs, setOpenedAs] = useState({
    open: false,
    query: initialQuery,
    moveRequest,
    page: initialPage,
  });
  if (
    openedAs.open !== open ||
    openedAs.query !== initialQuery ||
    openedAs.moveRequest !== moveRequest ||
    openedAs.page !== initialPage
  ) {
    setOpenedAs({ open, query: initialQuery, moveRequest, page: initialPage });
    if (open) {
      setQuery(initialQuery);
      setMoveSubject(moveRequest);
      setPage(moveRequest === null ? initialPage : "move-to-folder");
      setMatchResult(null);
      setMatchesFailed(false);
      setProblems(null);
      setProblemsFailed(false);
    }
  }

  // read once per visit to the page, not per keystroke: the query filters the rows it holds
  useEffect(() => {
    if (!open || page !== "problems") {
      return undefined;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const result = await problemSource(
          { limit: KNOWLEDGE_PROBLEMS_DEFAULT_LIMIT },
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setProblems(result);
          setProblemsFailed(false);
        }
      } catch {
        if (!controller.signal.aborted) {
          setProblems(null);
          setProblemsFailed(true);
        }
      }
    })();
    return () => {
      controller.abort();
    };
  }, [open, page, problemSource]);

  useEffect(() => {
    if (!open || (page !== "root" && page !== "notes")) {
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

  // one read of the index for the typed query; the debounce and a finished replace both run it
  const searchMatches = useCallback(
    async (signal: AbortSignal): Promise<void> => {
      try {
        const result = await matchSource(
          { q: query, caseSensitive, wholeWord, limit: KNOWLEDGE_MATCHES_DEFAULT_LIMIT },
          signal,
        );
        if (!signal.aborted) {
          setMatchResult(result);
          setMatchesFailed(false);
        }
      } catch {
        if (!signal.aborted) {
          setMatchResult(null);
          setMatchesFailed(true);
        }
      }
    },
    [query, caseSensitive, wholeWord, matchSource],
  );

  useEffect(() => {
    if (!open || page !== "search" || query === "") {
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void searchMatches(controller.signal);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, page, query, searchMatches]);

  const close = (): void => onOpenChange(false);

  const startReplace = (request: VaultReplaceRequest): void => {
    const controller = new AbortController();
    setReplaceRun({ done: 0, total: request.paths.length, cancelled: false, controller });
    void actions
      .replaceAll(request, {
        signal: controller.signal,
        onProgress: (done, total) => {
          setReplaceRun((current) => (current === null ? null : { ...current, done, total }));
        },
      })
      .finally(() => {
        setReplaceRun(null);
        // the listing re-reads what the rewrite left, so the replaced needle shows as gone
        void searchMatches(new AbortController().signal);
      });
  };
  const run = (action: () => void): void => {
    close();
    action();
  };

  const dirPaths = entries.filter((entry) => entry.kind === "dir").map((entry) => entry.path);
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
      run: () => {
        setQuery("");
        setPage("new-note-folder");
      },
    },
    {
      id: "new-note-from-template",
      label: "New note from template…",
      icon: <LayoutTemplateIcon />,
      keepOpen: true,
      run: () => {
        setQuery("");
        setPage("new-note-template");
      },
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
            run: () => {
              setQuery("");
              setPage("insert-template");
            },
          },
        ]
      : []),
    {
      id: "search-vault",
      label: "Search across the vault…",
      binding: "open-search",
      icon: <SearchIcon />,
      keepOpen: true,
      run: () => {
        setQuery("");
        setPage("search");
      },
    },
    ...(actions.listHeadings !== null
      ? [
          {
            id: "go-to-heading",
            label: "Go to heading…",
            binding: "open-headings" as const,
            icon: <HeadingIcon />,
            keepOpen: true,
            run: () => {
              setQuery("");
              setPage("headings");
            },
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
    ...(actions.pinNote !== null
      ? [
          {
            id: "pin-note",
            label: "Pin note",
            icon: <PinIcon />,
            run: () => actions.pinNote?.(),
          },
        ]
      : []),
    ...(actions.unpinNote !== null
      ? [
          {
            id: "unpin-note",
            label: "Unpin note",
            icon: <PinOffIcon />,
            run: () => actions.unpinNote?.(),
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
      id: "problems",
      label: "Problems",
      icon: <TriangleAlertIcon />,
      keepOpen: true,
      run: () => {
        setQuery("");
        setPage("problems");
      },
    },
    {
      id: "keyboard-shortcuts",
      label: "Keyboard shortcuts",
      icon: <KeyboardIcon />,
      keepOpen: true,
      run: () => {
        setQuery("");
        setPage("shortcuts");
      },
    },
    {
      id: "settings",
      label: "Settings",
      binding: "open-settings",
      icon: <SettingsIcon />,
      run: () => actions.openSettings(),
    },
  ];

  if (page === "headings") {
    const rows = actions.listHeadings === null ? [] : actions.listHeadings();
    const visible = rows.filter((row) => matchesQuery(row.title, query));
    return (
      <CommandDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Go to heading"
        description="Jump to a heading in this note"
        shouldFilter={false}
      >
        <CommandInput placeholder="Go to heading…" value={query} onValueChange={setQuery} />
        <CommandList>
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
        </CommandList>
      </CommandDialog>
    );
  }

  if (page === "problems") {
    const families = problems === null ? [] : problemFamilies(problems, query);
    const hidden = problems === null ? 0 : problemsHidden(problems);
    return (
      <CommandDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Problems"
        description="What the vault's links cannot resolve"
        shouldFilter={false}
        className="sm:max-w-2xl"
      >
        <CommandInput placeholder="Filter problems…" value={query} onValueChange={setQuery} />
        <CommandList className="max-h-96">
          <CommandEmpty>
            {problemsFailed
              ? "Could not read the index just now."
              : problems === null
                ? "…"
                : query === ""
                  ? "No problems: every link resolves, every note is linked, every stem is unique."
                  : "No problem matches."}
          </CommandEmpty>
          {families.map((family) => (
            <CommandGroup key={family.id} heading={`${family.heading} · ${family.total}`}>
              {family.rows.map((row) => (
                <CommandItem
                  key={row.id}
                  value={row.id}
                  onSelect={() =>
                    run(() =>
                      row.target === undefined
                        ? actions.openNote(row.path)
                        : actions.openProblemLink(row.path, row.target),
                    )
                  }
                >
                  <span className="min-w-0 flex-1 truncate">{row.label}</span>
                  <span className="ml-auto shrink-0 pl-3 text-xs text-muted-foreground tabular-nums">
                    {row.detail}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
          {hidden > 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {hidden} more not shown; `inteligir problems --limit` lists them all.
            </p>
          ) : null}
        </CommandList>
      </CommandDialog>
    );
  }

  if (page === "shortcuts") {
    const groups = shortcutGroups(modifier)
      .map((group) => ({
        heading: group.heading,
        rows: group.rows.filter(
          (row) => matchesQuery(row.label, query) || matchesQuery(row.chord, query),
        ),
      }))
      .filter((group) => group.rows.length > 0);
    return (
      <CommandDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Keyboard shortcuts"
        description="Every binding, spelled for this keyboard"
        shouldFilter={false}
      >
        <CommandInput placeholder="Filter shortcuts…" value={query} onValueChange={setQuery} />
        <CommandList>
          <CommandEmpty>No shortcut matches.</CommandEmpty>
          {groups.map((group) => (
            <CommandGroup key={group.heading} heading={group.heading}>
              {group.rows.map((row) => (
                <CommandItem key={row.id} value={row.id} onSelect={close}>
                  {row.label}
                  <CommandShortcut>{row.chord}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    );
  }

  if (page === "search") {
    const result = query === "" ? null : matchResult;
    const matches = result?.matches ?? [];
    const total = result?.total ?? 0;
    // a cut listing names some of the notes a replace would touch, not all of them
    const truncated = matches.length < total;
    const paths = [...new Set(matches.map((match) => match.path))];
    const canReplace = matches.length > 0 && !truncated && replaceRun === null;
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
            onClick={() => {
              startReplace({
                needle: query,
                replacement,
                options: { caseSensitive, wholeWord },
                paths,
              });
            }}
          >
            Replace all
          </Button>
        </div>
        {replaceRun === null ? null : (
          <div className="flex items-center gap-2 px-3 pt-1.5 text-xs text-muted-foreground">
            <span aria-live="polite" className="tabular-nums">
              Replacing… {replaceRun.done} of {replaceRun.total} notes
            </span>
            <Button
              variant="ghost"
              size="compact"
              disabled={replaceRun.cancelled}
              onClick={() => {
                replaceRun.controller.abort();
                setReplaceRun((current) =>
                  current === null ? null : { ...current, cancelled: true },
                );
              }}
            >
              {replaceRun.cancelled ? "Stopping…" : "Cancel"}
            </Button>
          </div>
        )}
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

  if (page === "new-note-template") {
    return (
      <TemplatePage
        open={open}
        onOpenChange={onOpenChange}
        title="New note from template"
        description="Pick the template the new note starts from"
        placeholder="New note from which template?"
        query={query}
        onQueryChange={setQuery}
        templatePaths={templatePaths}
        onPick={(path) => run(() => actions.newNoteFromTemplate(path))}
      />
    );
  }

  if (page === "insert-template") {
    return (
      <TemplatePage
        open={open}
        onOpenChange={onOpenChange}
        title="Insert template"
        description="Pick the template to insert at the cursor"
        placeholder="Insert which template?"
        query={query}
        onQueryChange={setQuery}
        templatePaths={templatePaths}
        onPick={(path) => run(() => actions.insertTemplate?.(path))}
      />
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

  const quickOpen = page === "notes";
  const visibleCommands = quickOpen
    ? []
    : commands.filter((command) => matchesQuery(command.label, query));

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={quickOpen ? "Open a note" : "Command palette"}
      description={quickOpen ? "Jump to a note by name" : "Open a note or run a command"}
      shouldFilter={false}
    >
      <CommandInput
        placeholder={quickOpen ? "Open a note…" : "Search notes or commands…"}
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
                {command.binding !== undefined ? (
                  <CommandShortcut>{bindingFor(command.binding, modifier)}</CommandShortcut>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
