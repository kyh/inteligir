import type { ThreadEvent } from "@repo/domain/provider-event";
import type { ViewContext } from "@repo/domain/view-context";
import type { PendingInteraction } from "@repo/contract/local/threads/threads-schema";

// what a stop found: a turn that will still report its own end through the sink, or none that
// ever will, which leaves settling the stop to the caller.
export type TurnInterrupt = "settling" | "not-running";

// a write the agent made through the server rather than its own tools, named by the thread whose
// shell sent it; a thread with no turn running records nothing.
export type RecordAgentWrites = (threadId: string, paths: readonly string[]) => void;

export interface TurnDriver {
  // called outside any transaction: the driver may synchronously report events back through the sink.
  startTurn: (args: TurnDriverStartArgs) => void;
  // called outside any transaction, after the thread reads stopping; may report through the sink
  // before it returns.
  interruptTurn: (threadId: string) => TurnInterrupt;
  // called after the row is resolved.
  onInteractionResolved?: (interaction: PendingInteraction) => void;
  // lands in the turn's commit like a write its tools reported.
  recordAgentWrites?: RecordAgentWrites;
  dispose?: () => Promise<void>;
}

// what a message asks its turn to carry, beside the text the user typed.
export interface TurnRequest {
  text: string;
  contextPaths?: readonly string[] | undefined;
  viewContext?: ViewContext | undefined;
  // the phone's dispatch the message carries out, stated on its request so the phone finds it
  dispatchId?: string | undefined;
}

export interface TurnDriverStartArgs extends TurnRequest {
  threadId: string;
  turnId: string;
}

export interface ProviderEventSink {
  ingestProviderEvents: (threadId: string, events: readonly ThreadEvent[]) => void;
}

export class TurnDriverUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TurnDriverUnavailableError";
  }
}

export const createUnavailableTurnDriver = (message: string): TurnDriver => ({
  interruptTurn: () => "not-running",
  startTurn() {
    throw new TurnDriverUnavailableError(message);
  },
});

export const unavailableTurnDriver: TurnDriver = createUnavailableTurnDriver(
  "No agent provider is configured",
);
