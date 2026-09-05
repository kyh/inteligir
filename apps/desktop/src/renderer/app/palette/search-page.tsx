import { Button } from "@repo/ui/components/button";
import { CommandEmpty, CommandGroup, CommandItem } from "@repo/ui/components/command";
import { Tooltip } from "@repo/ui/components/tooltip";
import { cn } from "@repo/ui/lib/utils";
import {
  KNOWLEDGE_MATCHES_DEFAULT_LIMIT,
  type VaultMatchWire,
} from "@repo/api/local/knowledge/knowledge-schema";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { orpc } from "../api";
import { PalettePage, SEARCH_DEBOUNCE_MS, useDebounced, type PageShell } from "./palette-page";
import type { ReplaceProgressPort, VaultReplaceRequest } from "./vault-replace";

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

// the run in flight: its counts, and the controller the Cancel button aborts
interface ReplaceRun {
  done: number;
  total: number;
  cancelled: boolean;
  controller: AbortController;
}

export interface SearchPageProps extends PageShell {
  onOpenMatch: (match: VaultMatchWire, query: string) => void;
  // settles when the run is over, cancelled or declined included; the page shows it running
  onReplaceAll: (request: VaultReplaceRequest, port: ReplaceProgressPort) => Promise<void>;
}

export function SearchPage({ onOpenMatch, onReplaceAll, ...shell }: SearchPageProps) {
  const queryClient = useQueryClient();
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [replacement, setReplacement] = useState("");
  const [replaceRun, setReplaceRun] = useState<ReplaceRun | null>(null);
  const settledQuery = useDebounced(shell.query, SEARCH_DEBOUNCE_MS);

  const vaultMatches = useQuery({
    ...orpc.knowledge.matches.queryOptions({
      input: {
        q: settledQuery,
        caseSensitive,
        wholeWord,
        limit: KNOWLEDGE_MATCHES_DEFAULT_LIMIT,
      },
    }),
    enabled: shell.open && settledQuery !== "",
    // a toggle re-keys the read; the listing it had stays up until the new one lands
    placeholderData: (previous) => previous,
  });

  const startReplace = (request: VaultReplaceRequest): void => {
    const controller = new AbortController();
    setReplaceRun({ done: 0, total: request.paths.length, cancelled: false, controller });
    void onReplaceAll(request, {
      signal: controller.signal,
      onProgress: (done, total) => {
        setReplaceRun((current) => (current === null ? null : { ...current, done, total }));
      },
    }).finally(() => {
      setReplaceRun(null);
      // the listing re-reads what the rewrite left, so the replaced needle shows as gone
      void queryClient.invalidateQueries({ queryKey: orpc.knowledge.matches.key() });
    });
  };

  const result = settledQuery === "" ? undefined : vaultMatches.data;
  const matches = result?.matches ?? [];
  const total = result?.total ?? 0;
  // a cut listing names some of the notes a replace would touch, not all of them
  const truncated = matches.length < total;
  const paths = [...new Set(matches.map((match) => match.path))];
  const canReplace = matches.length > 0 && !truncated && replaceRun === null;

  return (
    <PalettePage
      {...shell}
      title="Search the vault"
      description="Every match, with the line it sits on"
      placeholder="Search across the vault…"
      wide
      toolbar={
        <>
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
                  needle: shell.query,
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
        </>
      }
    >
      <CommandEmpty>
        {shell.query === ""
          ? "Type to search every note."
          : vaultMatches.isError
            ? "Could not search just now."
            : result === undefined
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
              onSelect={() => onOpenMatch(row, shell.query)}
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
    </PalettePage>
  );
}
