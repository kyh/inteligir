import { useCallback, useEffect, useRef, useState } from "react";
import {
  FilePlusIcon,
  FileTextIcon,
  FolderIcon,
  MoonIcon,
  RefreshCwIcon,
  SunIcon,
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

import { getBridge } from "@renderer/lib/bridge";
import { useTheme } from "@renderer/lib/use-theme";
import { useViewStore } from "@renderer/stores/view-store";
import { useVault } from "@renderer/workspace/vault-context";
import type { SearchResult } from "@repo/core/knowledge/knowledge-index";

const SEARCH_DEBOUNCE_MS = 150;
const SEARCH_LIMIT = 8;

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

/**
 * The ⌘K command palette: fuzzy-search notes by filename, full-text search
 * their contents (searchVault, debounced as-you-type), create a note from the
 * typed name, and run a handful of workspace commands. Opened by ⌘K
 * (WorkspacePage) and the sidebar's "Quick actions" pill.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { entries, openFile, createFile, changeFolder, refreshVault } = useVault();
  const setSurface = useViewStore((s) => s.setSurface);
  const { resolved, setTheme } = useTheme();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Clear the filter on every close, no matter the path — Esc / select run
  // `close()`, but ⌘K-to-dismiss toggles `open` in WorkspacePage and bypasses
  // it, so reopening would otherwise show stale query text.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setHits([]);
    }
  }, [open]);

  // Debounced full-text search; a stale response never lands over a newer
  // query (sequence check).
  const searchSeq = useRef(0);
  useEffect(() => {
    const trimmedQuery = query.trim();
    const seq = ++searchSeq.current;
    if (!open || trimmedQuery === "") {
      setHits([]);
      return;
    }
    const timer = setTimeout(() => {
      getBridge()
        ?.searchVault({ query: trimmedQuery, limit: SEARCH_LIMIT })
        .then((results) => {
          if (seq === searchSeq.current) setHits(results);
          return undefined;
        })
        .catch(() => {});
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, open]);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  // Run an action then dismiss — every item closes the palette.
  const run = useCallback(
    (action: () => void) => {
      action();
      close();
    },
    [close],
  );

  const trimmed = query.trim();
  const lower = trimmed.toLowerCase();
  const exists = entries.some(
    (e) => e.path.toLowerCase() === lower || e.path.toLowerCase() === `${lower}.md`,
  );

  // Notes = filename matches, then full-text hits that the filename filter
  // missed (deduped by path, host ranking preserved).
  const nameMatches =
    trimmed === "" ? entries : entries.filter((e) => matchesQuery(e.path, trimmed));
  const namePaths = new Set(nameMatches.map((e) => e.path));
  const contentHits = hits.filter((hit) => !namePaths.has(hit.path));

  const actions = [
    {
      value: "graph",
      keywords: "open graph view links map",
      icon: <WaypointsIcon />,
      label: "Open graph view",
      onSelect: () => setSurface("graph"),
    },
    {
      value: "theme",
      keywords: "toggle theme dark light appearance",
      icon: resolved === "dark" ? <SunIcon /> : <MoonIcon />,
      label: `Switch to ${resolved === "dark" ? "light" : "dark"} theme`,
      onSelect: () => setTheme(resolved === "dark" ? "light" : "dark"),
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
    (action) => trimmed === "" || matchesQuery(`${action.label} ${action.keywords}`, trimmed),
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      initialFocus={inputRef}
      shouldFilter={false}
    >
      {/* Filtering is app-side (filename terms + host-ranked full text). */}
      <CommandInput
        ref={inputRef}
        value={query}
        onValueChange={setQuery}
        placeholder="Search notes or run a command…"
      />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>

        {(nameMatches.length > 0 || contentHits.length > 0) && (
          <CommandGroup heading="Notes">
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
                  <span className="truncate text-xs text-muted-foreground">{hit.snippet}</span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {trimmed.length > 0 && !exists && (
          <CommandGroup heading="Create">
            <CommandItem
              value={`__create__ ${trimmed}`}
              onSelect={() => run(() => void createFile(trimmed))}
            >
              <FilePlusIcon />
              <span>
                Create <span className="font-medium text-foreground">{trimmed}</span>
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
                onSelect={() => run(action.onSelect)}
              >
                {action.icon}
                <span>{action.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
