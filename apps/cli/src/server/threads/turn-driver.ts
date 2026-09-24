import type { ThreadEvent } from "@repo/domain/provider-event";
import type { ViewContext } from "@repo/domain/view-context";
import type { PendingInteraction } from "@repo/api/local/threads/threads-schema";

// what a stop found: a turn that will still report its own end through the sink, or none that
// ever will, which leaves settling the stop to the caller.
export type TurnInterrupt = "settling" | "not-running";

export interface TurnDriver {
  // called outside any transaction: the driver may synchronously report events back through the sink.
  startTurn: (args: TurnDriverStartArgs) => void;
  // called outside any transaction, after the thread reads stopping; may report through the sink
  // before it returns.
  interruptTurn: (threadId: string) => TurnInterrupt;
  // called after the row is resolved.
  onInteractionResolved?: (interaction: PendingInteraction) => void;
}

// what a message asks its turn to carry, beside the text the user typed.
export interface TurnRequest {
  text: string;
  contextPaths?: readonly string[] | undefined;
  viewContext?: ViewContext | undefined;
}

export interface TurnDriverStartArgs extends TurnRequest {
  threadId: string;
  turnId: string;
}

export interface ProviderEventSink {
  ingestProviderEvents: (threadId: string, events: readonly ThreadEvent[]) => void;
}

export type CreateTurnDriver = (sink: ProviderEventSink) => TurnDriver;

export class TurnDriverUnavailableError extends Error {
  constructor(message?: string) {
    super(message ?? "No agent provider is configured");
    this.name = "TurnDriverUnavailableError";
  }
}

export const createUnavailableTurnDriver = (message?: string): TurnDriver => ({
  interruptTurn: () => "not-running",
  startTurn() {
    throw new TurnDriverUnavailableError(message);
  },
});

export const unavailableTurnDriver: TurnDriver = createUnavailableTurnDriver();
