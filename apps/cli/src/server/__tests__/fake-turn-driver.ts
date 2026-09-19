import type { ThreadEventTurnStatus } from "@repo/domain/provider-event";
import { turnScope } from "@repo/domain/thread-event-scope";
import { agentMessageEvents } from "../agents/agent-message-events";
import type { ProviderEventSink, TurnDriver, TurnDriverStartArgs } from "../threads/turn-driver";

export interface FakeTurnDriverOptions {
  // scripted streams a whole turn synchronously; manual emits only turn/started; inert emits nothing.
  mode: "scripted" | "manual" | "inert";
}

export class FakeTurnDriver implements TurnDriver {
  readonly startedTurns: TurnDriverStartArgs[] = [];
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
      { scope, threadId: args.threadId, type: "turn/started" },
    ]);
    if (this.options.mode === "manual") {
      return;
    }

    const itemId = `item_${args.turnId}`;
    const text = `Echo: ${args.text}`;
    this.sink.ingestProviderEvents(
      args.threadId,
      agentMessageEvents({ itemId, scope, text, threadId: args.threadId }),
    );
    this.sink.ingestProviderEvents(args.threadId, [
      { scope, status: "completed", threadId: args.threadId, type: "turn/completed" },
    ]);
  }

  completeTurn(threadId: string, turnId: string, status: ThreadEventTurnStatus): void {
    this.sink.ingestProviderEvents(threadId, [
      { scope: turnScope(turnId), status, threadId, type: "turn/completed" },
    ]);
  }
}
