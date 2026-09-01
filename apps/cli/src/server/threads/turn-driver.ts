import type { ThreadEvent } from "@repo/domain/provider-event";
import type { ViewContext } from "@repo/domain/view-context";
import type { PendingInteraction } from "@repo/api/local/threads/threads-schema";

/**
 * The provider seam. A driver ACCEPTS work synchronously and reports
 * everything the turn produces later, as ThreadEvents into the sink it was
 * constructed with — the same append path a report over any transport ends
 * in, so the scripted test driver and the real adapter are
 * indistinguishable below this line.
 */
export interface TurnDriver {
  /**
   * Accept a new turn. Called OUTSIDE any transaction — the driver may
   * synchronously report events back through the sink. Throws
   * TurnDriverUnavailableError when no provider is configured; any throw is
   * folded into the log as a dispatch failure.
   */
  startTurn(args: TurnDriverStartArgs): void;
  /**
   * The answer route resolved a pending interaction this driver produced.
   * Called AFTER the row is resolved; a driver holding the provider's
   * request open parses `interaction.resolution` and answers the process.
   */
  onInteractionResolved?(interaction: PendingInteraction): void;
}

export interface TurnDriverStartArgs {
  threadId: string;
  turnId: string;
  text: string;
  /** What the sender was looking at, when this host can name it. Omitted for
   *  the CLI, the palette, a chat with no note open — and for a QUEUED
   *  message, which drains long after its screen went away. */
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

/** Accepts nothing, honestly — a send answers 503 (with the stated reason)
 *  instead of wedging a thread in starting. */
export function createUnavailableTurnDriver(message?: string): TurnDriver {
  return {
    startTurn() {
      throw new TurnDriverUnavailableError(message);
    },
  };
}

export const unavailableTurnDriver: TurnDriver = createUnavailableTurnDriver();
