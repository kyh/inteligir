import type { ThreadEvent } from "@repo/domain/provider-event";

/**
 * The provider seam. A driver ACCEPTS work synchronously and reports
 * everything the turn produces later, as ThreadEvents into the sink it was
 * constructed with — the same append path a report over any transport ends
 * in, so the scripted test driver and the real adapter (#549) are
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
   * Inject input into the running turn; false when it cannot be steered.
   * Called INSIDE the send transaction, so it must answer synchronously and
   * must not touch the database — an adapter queues the injection and
   * reports the provider's echo later, through the sink.
   */
  steerTurn(args: TurnDriverSteerArgs): boolean;
}

export interface TurnDriverStartArgs {
  threadId: string;
  turnId: string;
  text: string;
}

export type TurnDriverSteerArgs = TurnDriverStartArgs;

export interface ProviderEventSink {
  ingestProviderEvents(threadId: string, events: readonly ThreadEvent[]): void;
}

export type CreateTurnDriver = (sink: ProviderEventSink) => TurnDriver;

export class TurnDriverUnavailableError extends Error {
  constructor() {
    super("No agent provider is configured");
    this.name = "TurnDriverUnavailableError";
  }
}

/** The default until the provider adapter (#549) lands: accepts nothing,
 *  honestly — a send answers 503 instead of wedging a thread in starting. */
export const unavailableTurnDriver: TurnDriver = {
  startTurn() {
    throw new TurnDriverUnavailableError();
  },
  steerTurn() {
    return false;
  },
};
