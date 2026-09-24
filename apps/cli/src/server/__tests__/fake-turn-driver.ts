import type { ThreadEventTurnStatus } from "@repo/domain/provider-event";
import { turnScope } from "@repo/domain/thread-event-scope";
import { agentMessageEvents } from "../agents/agent-message-events";
import type {
  ProviderEventSink,
  TurnDriver,
  TurnDriverStartArgs,
  TurnInterrupt,
} from "../threads/turn-driver";

export interface FakeTurnDriverOptions {
  // scripted streams a whole turn synchronously; manual emits only turn/started; inert emits nothing.
  mode: "scripted" | "manual" | "inert";
}

export class FakeTurnDriver implements TurnDriver {
  readonly startedTurns: TurnDriverStartArgs[] = [];
  readonly interruptedThreads: string[] = [];
  failNextStart: Error | null = null;
  // a manual turn honours a stop at once; off, it stays stopping until a test completes it.
  settleOnInterrupt = true;
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

  // an inert turn never reached a provider, so nothing will report its end.
  interruptTurn(threadId: string): TurnInterrupt {
    this.interruptedThreads.push(threadId);
    if (this.options.mode === "inert") {
      return "not-running";
    }
    const running = this.startedTurns.findLast((turn) => turn.threadId === threadId);
    if (this.settleOnInterrupt && running !== undefined) {
      this.completeTurn(threadId, running.turnId, "interrupted");
    }
    return "settling";
  }

  completeTurn(threadId: string, turnId: string, status: ThreadEventTurnStatus): void {
    this.sink.ingestProviderEvents(threadId, [
      { scope: turnScope(turnId), status, threadId, type: "turn/completed" },
    ]);
  }
}
