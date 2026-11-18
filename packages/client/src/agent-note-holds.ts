// The agent's edits of a note as a device's open note is held through them: an `edit_item` call
// from its tool_use until its tool_result or the end of its turn, in any conversation the device
// follows (`./thread-queries`). A call that never closes, its stream dropped, is let go a minute
// after it began, so a note is never held for good.

import { agentEventSchema } from "@repo/contract/library/agent-events";
import { threadEventRowSchema } from "@repo/contract/library/library-wire";
import { partialMatchKey } from "@tanstack/query-core";
import type { QueryCache, QueryKey } from "@tanstack/query-core";
import { z } from "zod";

export const AGENT_HOLD_MS = 60_000;

// what a followed thread holds, its rows read one by one as they come
const followedRowsSchema = z.object({ rows: z.array(z.unknown()) });

// the one field of `edit_item`'s input a hold reads: the item it edits
const editInputSchema = z.object({ id: z.string().min(1) });

// Each `edit_item` call no result or turn end closed yet, by its call id, with the item it edits:
// `open` as `rows` leave it.
export const openNoteEdits = (
  rows: readonly unknown[],
  open: ReadonlyMap<string, string> = new Map(),
): ReadonlyMap<string, string> => {
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

// the part of a query a follower reads
interface ThreadQuery {
  readonly queryHash: string;
  readonly queryKey: QueryKey;
  readonly state: { readonly data: unknown };
}

// Tells `listener` each `edit_item` call as it opens and closes in the conversations `cache` holds
// under `eventsKey` (every thread's events), until the stop it answers. A call open as following
// begins is told as started, and one closed before it is never told.
export const followNoteEdits = (
  cache: QueryCache,
  eventsKey: QueryKey,
  listener: (move: NoteEditMove) => void,
  holdMs = AGENT_HOLD_MS,
): (() => void) => {
  // each thread's open calls, and how many of its rows they were read from
  const seen = new Map<string, { read: number; open: ReadonlyMap<string, string> }>();
  const expiries = new Map<string, ReturnType<typeof setTimeout>>();
  // calls let go unheard, which their thread's rows still hold open
  const expired = new Set<string>();

  const finish = (callId: string, itemId: string): void => {
    clearTimeout(expiries.get(callId));
    expiries.delete(callId);
    listener({ callId, itemId, phase: "finished" });
  };

  const moved = (before: ReadonlyMap<string, string>, open: ReadonlyMap<string, string>): void => {
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

  // only the rows since the last look are read: a reply as it is written moves none
  const look = (query: ThreadQuery): void => {
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
  return () => {
    stop();
    for (const expiry of expiries.values()) {
      clearTimeout(expiry);
    }
  };
};
