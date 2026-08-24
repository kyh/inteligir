// Test-only turn driver: proves the flow without a provider (#549 owns the
// real adapter). Everything it emits goes through the SAME ingest path a
// real adapter reports into, so sequences are server-assigned and lifecycle
// events fire exactly as they will in production.

import type { ThreadEventTurnStatus } from "@repo/domain/provider-event";
import { turnScope } from "@repo/domain/thread-event-scope";
import { agentMessageEvents } from "../agent/agent-message-events";
import type {
  ProviderEventSink,
  TurnDriver,
  TurnDriverStartArgs,
  TurnDriverSteerArgs,
} from "../threads/turn-driver";

export interface FakeTurnDriverOptions {
  /**
   * scripted — a start streams a whole turn synchronously (started, message
   * deltas, item/completed, turn/completed).
   * manual — a start emits only turn/started; the test settles the turn.
   * inert — a start is accepted and emits nothing; the thread holds starting.
   */
  mode: "scripted" | "manual" | "inert";
  steerable?: boolean;
}

export class FakeTurnDriver implements TurnDriver {
  readonly startedTurns: TurnDriverStartArgs[] = [];
  readonly steeredTurns: TurnDriverSteerArgs[] = [];
  /** When set, the next startTurn throws it (a dispatch crash) and resets. */
  failNextStart: Error | null = null;
  private readonly sink: ProviderEventSink;
  private readonly options: FakeTurnDriverOptions;

  constructor(sink: ProviderEventSink, options: FakeTurnDriverOptions) {
    this.sink = sink;
    this.options = options;
  }

  startTurn(args: TurnDriverStartArgs): void {
    if (this.failNextStart !== null) {
      const failure = this.failNextStart;
      this.failNextStart = null;
      throw failure;
    }
    this.startedTurns.push(args);
    if (this.options.mode === "inert") {
      return;
    }
    const scope = turnScope(args.turnId);
    this.sink.ingestProviderEvents(args.threadId, [
      { type: "turn/started", threadId: args.threadId, scope },
    ]);
    if (this.options.mode === "manual") {
      return;
    }

    const itemId = `item_${args.turnId}`;
    const text = `Echo: ${args.text}`;
    this.sink.ingestProviderEvents(
      args.threadId,
      agentMessageEvents({ threadId: args.threadId, itemId, text, scope }),
    );
    this.sink.ingestProviderEvents(args.threadId, [
      { type: "turn/completed", threadId: args.threadId, status: "completed", scope },
    ]);
  }

  steerTurn(args: TurnDriverSteerArgs): boolean {
    if (this.options.steerable === false) {
      return false;
    }
    this.steeredTurns.push(args);
    return true;
  }

  /** Settle a manually held turn the way a provider report would. */
  completeTurn(threadId: string, turnId: string, status: ThreadEventTurnStatus): void {
    this.sink.ingestProviderEvents(threadId, [
      { type: "turn/completed", threadId, status, scope: turnScope(turnId) },
    ]);
  }
}
