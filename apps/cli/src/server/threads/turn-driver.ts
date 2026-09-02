import type { ThreadEvent } from "@repo/domain/provider-event";
import type { ViewContext } from "@repo/domain/view-context";
import type { PendingInteraction } from "@repo/api/local/threads/threads-schema";

export interface TurnDriver {
  // called outside any transaction: the driver may synchronously report events back through the sink.
  startTurn(args: TurnDriverStartArgs): void;
  // called after the row is resolved.
  onInteractionResolved?(interaction: PendingInteraction): void;
}

export interface TurnDriverStartArgs {
  threadId: string;
  turnId: string;
  text: string;
  viewContext?: ViewContext;
}

export interface ProviderEventSink {
  ingestProviderEvents(threadId: string, events: readonly ThreadEvent[]): void;
}

export type CreateTurnDriver = (sink: ProviderEventSink) => TurnDriver;

export class TurnDriverUnavailableError extends Error {
  constructor(message?: string) {
    super(message ?? "No agent provider is configured");
    this.name = "TurnDriverUnavailableError";
  }
}

export function createUnavailableTurnDriver(message?: string): TurnDriver {
  return {
    startTurn() {
      throw new TurnDriverUnavailableError(message);
    },
  };
}

export const unavailableTurnDriver: TurnDriver = createUnavailableTurnDriver();
