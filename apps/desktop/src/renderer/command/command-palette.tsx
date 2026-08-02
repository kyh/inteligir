import { useCallback, useEffect, useRef, useState } from "react";
import {
  BotIcon,
  CalendarDaysIcon,
  CalendarFoldIcon,
  CalendarRangeIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderIcon,
  HistoryIcon,
  LayoutTemplateIcon,
  ListTodoIcon,
  LockIcon,
  MoonIcon,
  RefreshCwIcon,
  SunIcon,
  Volume2Icon,
  VolumeXIcon,
  WaypointsIcon,
} from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@repo/ui/components/command";
import { toast } from "@repo/ui/components/sonner";

import { notePrivacy, setNotePrivate } from "@repo/notes/markdown/frontmatter";

import {
  AGENT_INSTRUCTIONS_PATH,
  AGENT_INSTRUCTIONS_SKELETON,
} from "@repo/bridge/agent-instructions";
import {
  CADENCE_ORDER,
  CADENCES,
  TEMPLATES_DIR,
  isTemplatePath,
  type Cadence,
} from "@repo/bridge/daily-notes";

import { getBridge } from "@renderer/lib/bridge";
import { consumeSearchRequest, useSearchRequest } from "@renderer/command/search-request";
import { getLiveEditor } from "@renderer/editor/live-editor";
import { toggleEditorNotePrivate } from "@renderer/editor/note-privacy";
import { useTheme } from "@renderer/lib/use-theme";
import { useViewStore } from "@renderer/stores/view-store";
import { useVoiceStore } from "@renderer/stores/voice-store";
import { startReadAloud, stopReadAloud, useReadAloud } from "@renderer/voice/read-aloud";
import { openNoteState, useOpenNote } from "@renderer/workspace/open-note-store";
import { useCreateFromTemplate, useOpenPeriodicNote } from "@renderer/workspace/use-note-templates";
import { useVaultActions, useVaultListing } from "@renderer/workspace/vault-context";
import type { SearchResult } from "@repo/notes/knowledge/knowledge-index";
import { parseSearchQuery } from "@repo/notes/knowledge/vault-search";

const SEARCH_DEBOUNCE_MS = 150;
const SEARCH_LIMIT = 8;
// Cap how many filename matches the root list renders as CommandItems. An empty
// query would otherwise map EVERY vault file into cmdk (no virtualization) — a
// large vault mounts thousands of rows on every ⌘K open. Search still reaches
// every file; this only bounds what's shown at once (full-text hits are capped
// at SEARCH_LIMIT for the same reason).
const ROOT_NAME_LIMIT = 50;

/** Multi-step palette navigation. The root is search + commands; picking "New
 * note from template…" walks into template selection then note-naming, reusing
 * the same command input as the typed-name field. */
type Phase =
  | { kind: "root" }
  | { kind: "pickTemplate" }
  | { kind: "nameTemplate"; template: string };

/** Every whitespace-separated term must appear somewhere in the haystack —
 * the filename filter (filtering is ours: cmdk's scorer can't see the
 * host-ranked full-text results, so `shouldFilter` is off and both entry
 * kinds go through app-side matching). */
function matchesQuery(haystack: string, query: string): boolean {
  const lower = haystack.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term !== "")
    .every((term) => lower.includes(term));
}

/** Display label for a template entry — the path with the `templates/` prefix
 * dropped. */
function templateLabel(path: string): string {
  return path.startsWith(`${TEMPLATES_DIR}/`) ? path.slice(TEMPLATES_DIR.length + 1) : path;
}

/** Per-cadence palette presentation. The labels live in the shared cadence
 * table (@repo/bridge/daily-notes — the host reads it too); the icon and the
 * search keywords are palette-only copy, so they stay here rather than
 * bloating an isomorphic module with renderer concerns. ⌘D is advertised on
 * the daily row only — the hotkey is deliberately daily-only. */
const CADENCE_COMMANDS: Readonly<Record<Cadence, { icon: React.ReactNode; keywords: string }>> = {
  daily: { icon: <CalendarDaysIcon />, keywords: "open today daily note journal ⌘d" },
  weekly: { icon: <CalendarRangeIcon />, keywords: "open this week weekly note journal periodic" },
  monthly: {
    icon: <CalendarFoldIcon />,
    keywords: "open this month monthly note journal periodic",
  },
};

/**
 * The ⌘K command palette: fuzzy-search notes by filename, full-text search
 * their contents (searchVault, debounced as-you-type), narrow to a tag with a
 * `tag:<name>` term in the same box, create a note from the typed name or a
 * template, open today's note, and run a handful of workspace commands. Opened
 * by ⌘K (WorkspacePage) and the sidebar's "Quick actions" pill.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { entries } = useVaultListing();
  const { openFile, createFile, changeFolder, refreshVault, editNote } = useVaultActions();
  // Narrow subscriptions: only the private-toggle action's PRESENCE and
  // LABEL are render inputs; the live content is read imperatively at action
  // time (togglePrivate below), so typing never re-renders the palette.
  const openIsMarkdown = useOpenNote((s) => s.openDoc.kind === "markdown");
  const openIsPrivate = useOpenNote((s) => s.openDoc.kind === "markdown" && s.openDoc.isPrivate);
  // Read-aloud visibility: hidden for private notes (their bytes would leave
  // the device for TTS) and until TTS is configured. Unparseable frontmatter
  // still shows the command — the controller's fail-closed re-check refuses
  // with the privacy toast (defense in depth, the AI-funnel pattern).
  const readingAloud = useReadAloud((s) => s.active);
  const ttsConfigured = useVoiceStore((s) => s.ttsConfigured);
  const createFromTemplate = useCreateFromTemplate();
  // One hook per cadence: `useOpenPeriodicNote` reads that cadence's ui-state
  // rows, so the calls are unrolled (hooks can't be mapped) into a lookup the
  // command list indexes — the commands themselves stay table-driven.
  const openDaily = useOpenPeriodicNote("daily");
  const openWeekly = useOpenPeriodicNote("weekly");
  const openMonthly = useOpenPeriodicNote("monthly");
  const openPeriodic: Readonly<Record<Cadence, () => void>> = {
    daily: openDaily,
    monthly: openMonthly,
    weekly: openWeekly,
  };
  const setSurface = useViewStore((s) => s.setSurface);
  const setPastChatsOpen = useViewStore((s) => s.setPastChatsOpen);
  const { resolved, setTheme } = useTheme();
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "root" });
  const [hits, setHits] = useState<SearchResult[]>([]);
  const searchRequest = useSearchRequest((s) => s.query);
  const inputRef = useRef<HTMLInputElement>(null);

  // Clear the filter AND reset navigation on every close, no matter the path —
  // Esc / select run `close()`, but ⌘K-to-dismiss toggles `open` in
  // WorkspacePage and bypasses it, so reopening would otherwise show a stale
  // query or a half-walked template flow.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setHits([]);
      setPhase({ kind: "root" });
    }
  }, [open]);

  // An outside surface (deep-link search, inline `#tag` chip) asked for a
  // query. Seed the phase and box FIRST, then open: all three land in one
  // React flush, so the dialog never flashes the root list on its way to the
  // results. The close-reset above only fires on open→false, so it can't
  // undo this.
  useEffect(() => {
    if (searchRequest === null) return;
    setPhase({ kind: "root" });
    setQuery(searchRequest);
    onOpenChange(true);
    consumeSearchRequest();
  }, [searchRequest, onOpenChange]);

  // Debounced search; a stale response never lands over a newer query
  // (sequence check). Only the root phase searches notes — the sub-phases
  // reuse the query as a template filter / note name.
  const searchSeq = useRef(0);
  useEffect(() => {
    const { query: text, tag } = parseSearchQuery(query);
    const seq = ++searchSeq.current;
    if (!open || phase.kind !== "root" || (text === "" && tag === "")) {
      setHits([]);
      return;
    }
    const timer = setTimeout(() => {
      getBridge()
        .searchVault({ limit: SEARCH_LIMIT, query: text, tag })
        .then((results) => {
          if (seq === searchSeq.current) setHits(results);
          return undefined;
        })
        .catch(() => {});
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, open, phase.kind]);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  // Toggle the open note's `private: true` flag. ONE write path per SURFACE:
  // rich edits the frontmatter NODE (the Page-details seam — Plate serialize →
  // editNote persists it); raw rewrites the text through the same core YAML
  // helpers and lands via editNote. Unreadable frontmatter is refused — what
  // we can't read, we never rewrite (the properties panel's rule).
  const togglePrivate = useCallback(() => {
    // LIVE store read at action time — never a subscription (the palette must
    // not re-render per keystroke) and never a captured snapshot.
    const { openDoc, editor } = openNoteState();
    if (openDoc.kind !== "markdown") return;
    if (openDoc.surface.mode === "rich") {
      const live = getLiveEditor(openDoc.path);
      if (live === null || !toggleEditorNotePrivate(live)) {
        toast.error("Couldn't toggle private — fix the note's frontmatter first.");
      }
      return;
    }
    const next = setNotePrivate(editor.content, notePrivacy(editor.content) !== "private");
    if (next === null) {
      toast.error("Couldn't toggle private — fix the note's frontmatter first.");
      return;
    }
    editNote(openDoc.path, next);
  }, [editNote]);

  // Run an action then dismiss — every leaf item closes the palette.
  const run = useCallback(
    (action: () => void) => {
      action();
      close();
    },
    [close],
  );

  // Step into a sub-phase without closing (template flow); the query is reused
  // as that phase's field, so clear it on entry.
  const goto = useCallback((next: Phase) => {
    setPhase(next);
    setQuery("");
  }, []);

  // Escape backs out one navigation step instead of closing when inside the
  // template flow (the CommandDialog would otherwise dismiss the whole palette).
  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Escape" || phase.kind === "root") return;
      event.preventDefault();
      event.stopPropagation();
      // pickTemplate backs out to root; nameTemplate to pickTemplate.
      goto({ kind: phase.kind === "nameTemplate" ? "pickTemplate" : "root" });
    },
    [phase.kind, goto],
  );

  // The dialog scaffold every phase renders — ONE CommandDialog + wired
  // CommandInput + CommandList. Filtering is app-side (filename terms +
  // host-ranked full text), hence shouldFilter off. A render helper, not a
  // component: each phase's return keeps CommandDialog as its root element
  // type, so phase transitions reconcile in place and never remount the input.
  const paletteShell = (shell: {
    placeholder: string;
    onInputKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
    children: React.ReactNode;
  }) => (
    <CommandDialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      initialFocus={inputRef}
      shouldFilter={false}
    >
      <CommandInput
        ref={inputRef}
        value={query}
        onValueChange={setQuery}
        onKeyDown={shell.onInputKeyDown}
        placeholder={shell.placeholder}
      />
      <CommandList>{shell.children}</CommandList>
    </CommandDialog>
  );

  // The template sub-phases read the box verbatim (it is a filter, then a
  // filename); only the root parses it as a search.
  const trimmed = query.trim();
  const templates = entries.filter((e) => e.kind === "doc" && isTemplatePath(e.path));

  // ---- Template flow: pick a template --------------------------------------
  if (phase.kind === "pickTemplate") {
    const matches =
      trimmed === "" ? templates : templates.filter((e) => matchesQuery(e.path, trimmed));
    return paletteShell({
      placeholder: "Pick a template…  (Esc to go back)",
      onInputKeyDown: handleInputKeyDown,
      children: (
        <>
          <CommandEmpty>No templates found.</CommandEmpty>
          <CommandGroup heading="Templates">
            {matches.map((e) => (
              <CommandItem
                key={e.path}
                value={e.path}
                onSelect={() => goto({ kind: "nameTemplate", template: e.path })}
              >
                <LayoutTemplateIcon />
                <span className="truncate">{templateLabel(e.path)}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </>
      ),
    });
  }

  // ---- Template flow: name the new note ------------------------------------
  if (phase.kind === "nameTemplate") {
    const template = phase.template;
    return paletteShell({
      placeholder: `Name the note from ${templateLabel(template)}…  (Esc to go back)`,
      onInputKeyDown: handleInputKeyDown,
      children: (
        <>
          <CommandEmpty>Type a name for the new note.</CommandEmpty>
          {trimmed.length > 0 && (
            <CommandGroup heading="Create">
              <CommandItem
                value={`__from_template__ ${trimmed}`}
                onSelect={() => run(() => createFromTemplate(template, trimmed))}
              >
                <FilePlusIcon />
                <span>
                  Create <span className="font-medium text-foreground">{trimmed}</span> from{" "}
                  {templateLabel(template)}
                </span>
              </CommandItem>
            </CommandGroup>
          )}
        </>
      ),
    });
  }

  // ---- Root: search + commands ---------------------------------------------
  // One box. A `tag:<name>` term narrows to that tag host-side — the same
  // composition the agent's search_vault runs — and the host's answer IS the
  // whole result list: the local filename filter can't see tags, so it (and
  // note creation, and the command list) steps aside rather than showing rows
  // the filter doesn't apply to.
  const { query: text, tag } = parseSearchQuery(query);
  const tagged = tag !== "";
  const lower = text.toLowerCase();
  const exists = entries.some(
    (e) => e.path.toLowerCase() === lower || e.path.toLowerCase() === `${lower}.md`,
  );

  // Notes = filename matches, then full-text hits that the filename filter
  // missed (deduped by path, host ranking preserved).
  const nameMatches = tagged
    ? []
    : (text === "" ? entries : entries.filter((e) => matchesQuery(e.path, text))).slice(
        0,
        ROOT_NAME_LIMIT,
      );
  const namePaths = new Set(nameMatches.map((e) => e.path));
  const contentHits = hits.filter((hit) => !namePaths.has(hit.path));

  const actions: {
    value: string;
    keywords: string;
    icon: React.ReactNode;
    label: string;
    onSelect: () => void;
    keepOpen?: boolean;
  }[] = [
    ...CADENCE_ORDER.map((cadence) => ({
      value: cadence,
      keywords: CADENCE_COMMANDS[cadence].keywords,
      icon: CADENCE_COMMANDS[cadence].icon,
      label: CADENCES[cadence].commandLabel,
      onSelect: () => openPeriodic[cadence](),
    })),
    ...(templates.length > 0
      ? [
          {
            value: "new-from-template",
            keywords: "new note from template create",
            icon: <LayoutTemplateIcon />,
            label: "New note from template…",
            onSelect: () => goto({ kind: "pickTemplate" }),
            keepOpen: true,
          },
        ]
      : []),
    {
      value: "graph",
      keywords: "open graph view links map",
      icon: <WaypointsIcon />,
      label: "Open graph view",
      onSelect: () => setSurface("graph"),
    },
    {
      value: "tasks",
      keywords: "open tasks view todo checkbox list",
      icon: <ListTodoIcon />,
      label: "Open tasks view",
      onSelect: () => setSurface("tasks"),
    },
    {
      value: "theme",
      keywords: "toggle theme dark light appearance",
      icon: resolved === "dark" ? <SunIcon /> : <MoonIcon />,
      label: `Switch to ${resolved === "dark" ? "light" : "dark"} theme`,
      onSelect: () => setTheme(resolved === "dark" ? "light" : "dark"),
    },
    ...(openIsMarkdown
      ? [
          {
            value: "toggle-private",
            keywords: "toggle private note lock privacy ai off exclude",
            icon: <LockIcon />,
            label: openIsPrivate ? "Remove private mark from note" : "Mark note as private",
            onSelect: () => togglePrivate(),
          },
        ]
      : []),
    // Stateful pair, one command id: Stop is ALWAYS offered while a session
    // plays (even if the note flipped private mid-read — stopping must never
    // be gated); Read only for an open, non-private note with TTS configured.
    ...(readingAloud
      ? [
          {
            value: "read-aloud",
            keywords: "stop reading aloud voice speech tts",
            icon: <VolumeXIcon />,
            label: "Stop reading",
            onSelect: () => stopReadAloud(),
          },
        ]
      : openIsMarkdown && !openIsPrivate && ttsConfigured === true
        ? [
            {
              value: "read-aloud",
              keywords: "read page aloud note voice speech listen tts",
              icon: <Volume2Icon />,
              label: "Read page aloud",
              onSelect: () => void startReadAloud(),
            },
          ]
        : []),
    {
      value: "agent-instructions",
      keywords: "open agent instructions memory customize ai personalize agents.md",
      icon: <BotIcon />,
      label: "Open agent instructions",
      // Open-or-create: an existing vault/AGENTS.md opens untouched; an
      // absent one is created from the skeleton first (same idempotent path
      // daily notes + templates use).
      onSelect: () => void createFile(AGENT_INSTRUCTIONS_PATH, AGENT_INSTRUCTIONS_SKELETON),
    },
    {
      value: "past-chats",
      keywords: "browse past chats history previous conversations threads sessions",
      icon: <HistoryIcon />,
      label: "Browse past chats",
      // Read-only viewer — a past thread is never resumed (single-thread chat).
      onSelect: () => setPastChatsOpen(true),
    },
    {
      value: "refresh",
      keywords: "refresh vault reload rescan files sync snapshot",
      icon: <RefreshCwIcon />,
      label: "Refresh vault",
      onSelect: () => refreshVault(),
    },
    {
      value: "vault",
      keywords: "switch vault folder change directory",
      icon: <FolderIcon />,
      label: "Switch vault folder…",
      onSelect: () => void changeFolder(),
    },
  ].filter(
    (action) =>
      !tagged && (text === "" || matchesQuery(`${action.label} ${action.keywords}`, text)),
  );

  return paletteShell({
    placeholder: "Search notes (tag:name to filter) or run a command…",
    children: (
      <>
        <CommandEmpty>No results.</CommandEmpty>

        {(nameMatches.length > 0 || contentHits.length > 0) && (
          <CommandGroup heading={tagged ? `#${tag}` : "Notes"}>
            {nameMatches.map((e) => (
              <CommandItem key={e.path} value={e.path} onSelect={() => run(() => openFile(e.path))}>
                <FileTextIcon />
                <span className="truncate">{e.path}</span>
              </CommandItem>
            ))}
            {contentHits.map((hit) => (
              <CommandItem
                key={`hit:${hit.path}`}
                value={`hit:${hit.path}`}
                onSelect={() => run(() => openFile(hit.path))}
              >
                <FileTextIcon />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{hit.title}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {hit.snippet === "" ? hit.path : hit.snippet}
                  </span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {!tagged && text.length > 0 && !exists && (
          <CommandGroup heading="Create">
            <CommandItem
              value={`__create__ ${text}`}
              onSelect={() => run(() => void createFile(text))}
            >
              <FilePlusIcon />
              <span>
                Create <span className="font-medium text-foreground">{text}</span>
              </span>
            </CommandItem>
          </CommandGroup>
        )}

        {actions.length > 0 && (
          <CommandGroup heading="Actions">
            {actions.map((action) => (
              <CommandItem
                key={action.value}
                value={action.value}
                onSelect={() => (action.keepOpen ? action.onSelect() : run(action.onSelect))}
              >
                {action.icon}
                <span>{action.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </>
    ),
  });
}
