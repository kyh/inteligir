import { agentEventSchema } from "@repo/contract/library/agent-events";
import { threadEventRowSchema } from "@repo/contract/library/library-wire";
import { partialMatchKey } from "@tanstack/query-core";
import type { QueryCache, QueryKey } from "@tanstack/query-core";
import { z } from "zod";

export const AGENT_HOLD_MS = 60_000;

const followedRowsSchema = z.object({ rows: z.array(z.unknown()) });

const editInputSchema = z.object({ id: z.string().min(1) });

export const openNoteEdits = (
  rows: readonly unknown[],
  open: ReadonlyMap<string, string> = new Map(),
) => {
  const next = new Map(open);

  for (const row of rows) {
    const parsed = agentEventSchema.safeParse(threadEventRowSchema.safeParse(row).data?.event);

    if (!parsed.success) {
      continue;
    }

    const event = parsed.data;

    if (event.type === "agent.tool_use" && event.name === "edit_item") {
      const input = editInputSchema.safeParse(event.input);

      if (input.success) {
        next.set(event.toolUseId, input.data.id);
      }
    } else if (event.type === "agent.tool_result") {
      next.delete(event.toolUseId);
    } else if (event.type === "turn.ended") {
      next.clear();
    }
  }

  return next;
};

export interface NoteEditMove {
  readonly callId: string;
  readonly itemId: string;
  readonly phase: "started" | "finished";
}

interface ThreadQuery {
  readonly queryHash: string;
  readonly queryKey: QueryKey;
  readonly state: { readonly data: unknown };
}

export const followNoteEdits = (
  cache: QueryCache,
  eventsKey: QueryKey,
  listener: (move: NoteEditMove) => void,
  holdMs = AGENT_HOLD_MS,
) => {
  const seen = new Map<string, { read: number; open: ReadonlyMap<string, string> }>();
  const expiries = new Map<string, ReturnType<typeof setTimeout>>();
  const expired = new Set<string>();

  const finish = (callId: string, itemId: string) => {
    clearTimeout(expiries.get(callId));
    expiries.delete(callId);
    listener({ callId, itemId, phase: "finished" });
  };

  const moved = (before: ReadonlyMap<string, string>, open: ReadonlyMap<string, string>) => {
    for (const [callId, itemId] of before) {
      if (!open.has(callId) && !expired.delete(callId)) {
        finish(callId, itemId);
      }
    }

    for (const [callId, itemId] of open) {
      if (before.has(callId) || expired.has(callId)) {
        continue;
      }

      expiries.set(
        callId,
        setTimeout(() => {
          expired.add(callId);
          finish(callId, itemId);
        }, holdMs),
      );
      listener({ callId, itemId, phase: "started" });
    }
  };

  const look = (query: ThreadQuery) => {
    if (!partialMatchKey(query.queryKey, eventsKey)) {
      return;
    }

    const rows = followedRowsSchema.safeParse(query.state.data).data?.rows ?? [];
    const held = seen.get(query.queryHash);
    const from = held !== undefined && held.read <= rows.length ? held : null;

    if (from?.read === rows.length) {
      return;
    }

    const open = openNoteEdits(rows.slice(from?.read ?? 0), from?.open);
    moved(held?.open ?? new Map<string, string>(), open);
    seen.set(query.queryHash, { open, read: rows.length });
  };

  for (const query of cache.getAll()) {
    look(query);
  }

  const stop = cache.subscribe((event) => {
    const { query } = event;

    if (event.type === "removed") {
      moved(seen.get(query.queryHash)?.open ?? new Map<string, string>(), new Map());
      seen.delete(query.queryHash);

      return;
    }

    look(query);
  });

  return (() => {
    stop();

    for (const expiry of expiries.values()) {
      clearTimeout(expiry);
    }
  }) satisfies () => void;
};
