// Settings → Memory: the durable facts the agent keeps about the user.
//
// READ AND DELETE ONLY. The agent writes memory with its own shell (issue
// #575) — remembering IS its job, so there is no add form here and no per-fact
// gate. What this surface is FOR is the safety valve: the user sees everything
// the agent has recorded about them, reads a fact's full text, and deletes any
// it got wrong. It lives only here — never in the workspace, no palette
// command, no composer surface.
//
// The memory directory is not on the ws bus (it is machine-global, not the
// vault, and the agent edits it outside the app), so this query opts out of
// the fresh-forever default and re-reads on mount, exactly like Connectors;
// its own delete hands back the new listing directly.

import {
  MEMORY_TYPES,
  type MalformedMemory,
  type MemoryEntry,
  type MemoryListResponse,
  type MemoryType,
} from "@repo/server-contract/memory";
import { Button } from "@repo/ui/components/button";
import { confirm } from "@repo/ui/components/confirm-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { queryKeys, unwrap } from "../api";
import { useWorkspace } from "../workspace-context";
import { failed, SectionHeading } from "./settings-chrome";

const TYPE_LABELS: Record<MemoryType, string> = {
  user: "About you",
  preference: "Preferences",
};

function useMemory() {
  const { api } = useWorkspace();
  return useQuery<MemoryListResponse>({
    queryKey: queryKeys.memory,
    queryFn: async () => unwrap(await api.memory.$get()),
    staleTime: 0,
  });
}

interface MemoryItemProps {
  entry: MemoryEntry;
  expanded: boolean;
  onToggle: () => void;
  onForget: () => void;
  pending: boolean;
}

function MemoryItem({ entry, expanded, onToggle, onForget, pending }: MemoryItemProps) {
  return (
    <li className="space-y-0.5">
      <div className="flex items-baseline justify-between gap-2">
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
          onClick={onToggle}
          aria-expanded={expanded}
        >
          {entry.name}
        </button>
        <Button size="xs" variant="ghost" disabled={pending} onClick={onForget}>
          Forget
        </Button>
      </div>
      {entry.description.length > 0 ? (
        <p className="truncate text-xs text-muted-foreground" title={entry.description}>
          {entry.description}
        </p>
      ) : null}
      {expanded ? (
        <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted px-2 py-1 text-xs whitespace-pre-wrap">
          {entry.body.trim().length === 0 ? "(no body)" : entry.body}
        </pre>
      ) : null}
    </li>
  );
}

function MalformedList({
  files,
  onForget,
  pending,
}: {
  files: readonly MalformedMemory[];
  onForget: (file: string) => void;
  pending: boolean;
}) {
  if (files.length === 0) {
    return null;
  }
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">
        {files.length === 1 ? "1 file" : `${files.length} files`} could not be read as a memory:
      </p>
      <ul className="space-y-1">
        {files.map((entry) => (
          <li key={entry.file} className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate font-mono text-xs" title={entry.problem}>
              {entry.file} — {entry.problem}
            </span>
            <Button
              size="xs"
              variant="ghost"
              disabled={pending}
              onClick={() => onForget(entry.file)}
            >
              Forget
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MemorySection() {
  const { api } = useWorkspace();
  const queryClient = useQueryClient();
  const memoryQuery = useMemory();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const forget = (file: string, label: string): void => {
    void (async () => {
      const confirmed = await confirm({
        title: `Forget "${label}"?`,
        body: "The agent loses this note about you. It may relearn it later.",
        confirmLabel: "Forget",
        destructive: true,
      });
      if (!confirmed) {
        return;
      }
      setPending(true);
      try {
        const next = await unwrap(await api.memory.remove.$post({ json: { file } }));
        queryClient.setQueryData<MemoryListResponse>(queryKeys.memory, () => next);
      } catch (error) {
        failed(error, `Could not forget ${label}.`);
      } finally {
        setPending(false);
      }
    })();
  };

  const memory = memoryQuery.data;

  return (
    <section className="space-y-2">
      <SectionHeading>Memory</SectionHeading>
      <p className="text-xs text-muted-foreground">
        What the agent remembers about you across threads. It writes these as it works; delete
        anything it got wrong.
      </p>
      {memory === undefined ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : memory.memories.length === 0 && memory.malformed.length === 0 ? (
        <p className="text-sm text-muted-foreground">The agent has not recorded anything yet.</p>
      ) : (
        <div className="space-y-3">
          {MEMORY_TYPES.map((type) => {
            const items = memory.memories.filter((entry) => entry.type === type);
            if (items.length === 0) {
              return null;
            }
            return (
              <div key={type} className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">{TYPE_LABELS[type]}</p>
                <ul className="space-y-2">
                  {items.map((entry) => (
                    <MemoryItem
                      key={entry.file}
                      entry={entry}
                      expanded={expanded === entry.file}
                      onToggle={() =>
                        setExpanded((current) => (current === entry.file ? null : entry.file))
                      }
                      onForget={() => forget(entry.file, entry.name)}
                      pending={pending}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
          <MalformedList
            files={memory.malformed}
            onForget={(file) => forget(file, file)}
            pending={pending}
          />
        </div>
      )}
    </section>
  );
}
