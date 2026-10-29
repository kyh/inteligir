// A turn's events as the cell keeps them: each stored once by its id however often a stream or a
// listing meets it, a type this build never heard of stored raw, and the cumulative usage the
// session reports booked by its difference from the last report.

import type { BetaManagedAgentsStreamSessionEvents } from "@anthropic-ai/sdk/resources/beta/sessions/events";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { cellOf, clockAt, engineIn, inCell, landedValue } from "../test-support/library-cell";
import { keepEvent, roleOf } from "./turn-events";
import { holdSession } from "./turn-rows";

const WHERE = { sessionId: "sesn_kept", threadId: "thread-kept" };

const usageReport = (id: string, cents: number, input: number) =>
  ({
    id,
    processed_at: "2026-10-01T00:00:00Z",
    type: "session.usage",
    usage: {
      cache_read_input_tokens: input * 2,
      input_tokens: input,
      list_cost: { amount: String(cents), currency: "USD" },
      output_tokens: input / 10,
    },
  }) satisfies BetaManagedAgentsStreamSessionEvents;

const ledgerSchema = z.object({
  cached_tokens: z.number(),
  cost_cents: z.number(),
  input_tokens: z.number(),
  output_tokens: z.number(),
});

// what the cell kept of each event it met, in one transaction a batch
const kept = (
  state: DurableObjectState,
  events: readonly BetaManagedAgentsStreamSessionEvents[],
) => {
  const library = engineIn(state, clockAt());
  return landedValue(
    library.landApart({ answer: z.array(z.boolean()), opId: undefined }, (scope) => {
      holdSession(scope, WHERE.sessionId, WHERE.threadId);
      return events.map((event) => keepEvent(scope, WHERE, event) !== null);
    }),
  );
};

describe("a turn's events, kept", () => {
  it("are stored once by their id, however often they are met", async () => {
    await inCell(cellOf(), (state) => {
      const message = {
        content: [{ text: "Done.", type: "text" as const }],
        id: "sevt_message",
        processed_at: "2026-10-01T00:00:01Z",
        type: "agent.message" as const,
      };
      expect(kept(state, [message, message])).toEqual([true, false]);
      expect(kept(state, [message])).toEqual([false]);
      const rows = state.storage.sql
        .exec("SELECT idx, type FROM thread_events WHERE thread_id = ?", WHERE.threadId)
        .toArray();
      expect(rows).toEqual([{ idx: 0, type: "agent.message" }]);
    });
  });

  it("keeps a type this build never heard of, and lets go of what a thread never shows", async () => {
    // the SDK's unions are open, so a newer event arrives too, and a newer device may read it
    expect(roleOf("agent.hum")).toBe("store");
    await inCell(cellOf(), (state) => {
      const span = {
        id: "sevt_span",
        processed_at: "2026-10-01T00:00:03Z",
        type: "span.model_request_start" as const,
      };
      expect(kept(state, [span])).toEqual([false]);
      expect(state.storage.sql.exec("SELECT 1 FROM thread_events").toArray()).toEqual([]);
    });
  });

  it("books what a session spent as the difference from its last report", async () => {
    await inCell(cellOf(), (state) => {
      expect(
        kept(state, [usageReport("sevt_u1", 2, 1000), usageReport("sevt_u2", 5, 3000)]),
      ).toEqual([true, true]);
      // the second report met again books nothing more
      kept(state, [usageReport("sevt_u2", 5, 3000)]);
      const [ledger] = state.storage.sql
        .exec("SELECT cost_cents, input_tokens, cached_tokens, output_tokens FROM agent_usage")
        .toArray();
      expect(ledgerSchema.parse(ledger)).toEqual({
        cached_tokens: 6000,
        cost_cents: 5,
        input_tokens: 3000,
        output_tokens: 300,
      });
    });
  });
});
