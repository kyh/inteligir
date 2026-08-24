import type { AgentWriteMode } from "@repo/domain/agent-write-mode";
import type { ThreadEvent } from "@repo/domain/provider-event";
import type { ViewContext } from "@repo/domain/view-context";
import type { PendingInteraction } from "@repo/api/local/threads/threads-schema";

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
  /** Where this turn's file writes land — the thread's own column, read by
   *  the send that dispatched it so a driver never has to ask the db. */
  writeMode: AgentWriteMode;
  /** What the sender was looking at, when this host can name it. Omitted for
   *  the CLI, the palette, a chat with no note open — and for a QUEUED
   *  message, which drains long after its screen went away. */
  viewContext?: ViewContext;
}

/** A steer joins a turn that already chose its write mode, so it names none.
 *  It does name its OWN view context: a steer is a fresh statement about the
 *  past, exactly like any other message. */
export interface TurnDriverSteerArgs {
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

/** Accepts nothing, honestly — a send answers 503 (with the stated reason)
 *  instead of wedging a thread in starting. */
export function createUnavailableTurnDriver(message?: string): TurnDriver {
  return {
    startTurn() {
      throw new TurnDriverUnavailableError(message);
    },
    steerTurn() {
      return false;
    },
  };
}

export const unavailableTurnDriver: TurnDriver = createUnavailableTurnDriver();
