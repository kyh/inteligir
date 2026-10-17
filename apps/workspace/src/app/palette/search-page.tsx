import { CommandEmpty, CommandGroup, CommandItem } from "@repo/ui/components/command";
import { Tooltip } from "@repo/ui/components/tooltip";
import { cn } from "@repo/ui/lib/cn";
import { KNOWLEDGE_MATCHES_DEFAULT_LIMIT } from "@repo/contract/local/knowledge/knowledge-schema";
import type { VaultMatchWire } from "@repo/contract/local/knowledge/knowledge-schema";
import type { TextMatchOptions } from "@repo/notes/knowledge/text-matches";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { orpc } from "../api";
import { PalettePage, SEARCH_DEBOUNCE_MS, useDebounced } from "./palette-page";

interface MatchGroup {
  path: string;
  title: string;
  rows: VaultMatchWire[];
}

// one group per note, in the order the rows arrived (path order)
const groupMatches = (matches: readonly VaultMatchWire[]): MatchGroup[] => {
  const groups: MatchGroup[] = [];
  const byPath = new Map<string, MatchGroup>();
  for (const match of matches) {
    let group = byPath.get(match.path);
    if (group === undefined) {
      group = { path: match.path, rows: [], title: match.title };
      byPath.set(match.path, group);
      groups.push(group);
    }
    group.rows.push(match);
  }
  return groups;
};

const SearchToggle = ({
  pressed,
  label,
  onToggle,
  children,
}: {
  pressed: boolean;
  label: string;
  onToggle: () => void;
  children: React.ReactNode;
}) => (
  <Tooltip content={label}>
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      onClick={onToggle}
      className={cn(
        "h-7 shrink-0 rounded-md px-1.5 text-body font-medium text-muted-foreground hover:bg-hover hover:text-foreground",
        pressed && "bg-muted text-foreground",
      )}
    >
      {children}
    </button>
  </Tooltip>
);

export interface SearchPageProps {
  open: boolean;
  query: string;
  onOpenMatch: (match: VaultMatchWire, needle: string, options: TextMatchOptions) => void;
}

export const SearchPage = ({ open, query, onOpenMatch }: SearchPageProps) => {
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const settledQuery = useDebounced(query, SEARCH_DEBOUNCE_MS);

  const input = {
    caseSensitive,
    limit: KNOWLEDGE_MATCHES_DEFAULT_LIMIT,
    q: settledQuery,
    wholeWord,
  };
  const inputOptions: TextMatchOptions = {
    caseSensitive: input.caseSensitive,
    wholeWord: input.wholeWord,
  };
  const vaultMatches = useQuery({
    ...orpc.knowledge.matches.queryOptions({ input }),
    enabled: open && settledQuery !== "",
    // a toggle re-keys the read; the listing it had stays up until the new one lands
    placeholderData: (previous) => previous,
    // a retry would hold that listing up for seconds over a refusal, and a pick would jump to a
    // needle its row does not hold
    retry: false,
  });

  const result = settledQuery === "" ? undefined : vaultMatches.data;
  const matches = result?.matches ?? [];
  const total = result?.total ?? 0;
  const truncated = matches.length < total;

  const emptySentence = (): string => {
    if (query === "") {
      return "Type to search inside every item.";
    }
    if (vaultMatches.isError) {
      return "Could not search just now.";
    }
    return result === undefined ? "…" : "No matches.";
  };

  return (
    <PalettePage
      toolbar={
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
        </div>
      }
    >
      <CommandEmpty>{emptySentence()}</CommandEmpty>
      {groupMatches(matches).map((group) => (
        <CommandGroup
          key={group.path}
          heading={group.title === "" ? group.path : `${group.title} · ${group.path}`}
        >
          {group.rows.map((row) => (
            <CommandItem
              key={row.ordinal}
              action={`${group.title === "" ? group.path : group.title} line ${String(row.line)}`}
              onSelect={() => {
                onOpenMatch(row, input.q, inputOptions);
              }}
            >
              <span className="min-w-0 flex-1 truncate">
                <span className="text-muted-foreground">{row.before}</span>
                <mark className="rounded-[2px] bg-yellow-300/40 text-foreground dark:bg-yellow-500/25">
                  {row.text}
                </mark>
                <span className="text-muted-foreground">{row.after}</span>
              </span>
              <span className="ml-auto shrink-0 pl-3 text-body text-muted-foreground tabular-nums">
                {row.line}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      ))}
      {truncated ? (
        <p className="px-3 py-2 text-body text-muted-foreground">
          {matches.length} of {total} matches shown. Narrow the search to see the rest.
        </p>
      ) : null}
    </PalettePage>
  );
};
