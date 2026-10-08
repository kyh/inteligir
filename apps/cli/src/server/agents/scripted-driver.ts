// The scenario suite's agent: every turn answers `Noted: <text>` and completes, in process, with
// no provider behind it, so a test drives the whole thread path without spending a model call.

import { turnScope } from "@repo/domain/thread-event-scope";
import type {
  CreateTurnDriver,
  ProviderEventSink,
  TurnDriver,
  TurnDriverStartArgs,
  TurnInterrupt,
} from "../threads/turn-driver";
import { agentMessageEvents } from "./agent-message-events";

class ScriptedTurnDriver implements TurnDriver {
  private readonly sink: ProviderEventSink;

  constructor(sink: ProviderEventSink) {
    this.sink = sink;
  }

  startTurn(args: TurnDriverStartArgs): void {
    const scope = turnScope(args.turnId);
    const itemId = `item_${args.turnId}_message`;
    this.sink.ingestProviderEvents(args.threadId, [
      { scope, threadId: args.threadId, type: "turn/started" },
      ...agentMessageEvents({
        itemId,
        scope,
        text: `Noted: ${args.text}`,
        threadId: args.threadId,
      }),
    ]);
    this.sink.ingestProviderEvents(args.threadId, [
      { scope, status: "completed", threadId: args.threadId, type: "turn/completed" },
    ]);
  }

  // a scripted turn completes inside startTurn, so there is never one left to stop.
  // oxlint-disable-next-line class-methods-use-this -- the TurnDriver's instance API: the service calls it on the driver it was handed
  interruptTurn(): TurnInterrupt {
    return "not-running";
  }
}

export const createScriptedTurnDriverFactory = (): CreateTurnDriver => (sink) =>
  new ScriptedTurnDriver(sink);
