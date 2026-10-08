// The scenario suite's agent: every turn answers `Noted: <text>` and completes, in process, with
// no provider behind it, so a test drives the whole thread path without spending a model call. A
// turn asked `ask: <command>` first parks an approval for that command on the interaction waiters,
// the seam the observer's hook wait parks on, and answers with the decision, so the panel's and
// the phone's approval cards run end to end against it.

import type { DbConnection } from "@repo/db/connection";
import { interruptOpenPendingInteractions } from "@repo/db/pending-interactions";
import type { DbNotifier } from "@repo/domain/notifier";
import type { PendingInteractionResolution } from "@repo/domain/pending-interactions";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { turnScope } from "@repo/domain/thread-event-scope";
import type { PendingInteraction } from "@repo/contract/local/threads/threads-schema";
import type {
  CreateTurnDriver,
  ProviderEventSink,
  TurnDriver,
  TurnDriverStartArgs,
  TurnInterrupt,
} from "../threads/turn-driver";
import { agentMessageEvents } from "./agent-message-events";
import type { InteractionWaiters } from "./interaction-waiters";

export const SCRIPTED_ASK_PREFIX = "ask: ";

const answerTo = (command: string, resolution: PendingInteractionResolution): string =>
  `${resolution.decision === "deny" ? "Denied" : "Allowed"}: ${command}`;

interface ScriptedDriverDeps {
  db: DbConnection;
  notifier: DbNotifier;
  waiters: InteractionWaiters;
  // read when a parked turn's answer lands: a driver torn down reports nothing more.
  disposed: () => boolean;
}

class ScriptedTurnDriver implements TurnDriver {
  private readonly sink: ProviderEventSink;
  private readonly deps: ScriptedDriverDeps;
  // threads whose parked turn a stop cancelled, so its answer settles it interrupted.
  private readonly stopping = new Set<string>();

  constructor(sink: ProviderEventSink, deps: ScriptedDriverDeps) {
    this.sink = sink;
    this.deps = deps;
  }

  startTurn(args: TurnDriverStartArgs): void {
    const scope = turnScope(args.turnId);
    const started: ThreadEvent = { scope, threadId: args.threadId, type: "turn/started" };
    const command = args.text.startsWith(SCRIPTED_ASK_PREFIX)
      ? args.text.slice(SCRIPTED_ASK_PREFIX.length).trim()
      : "";
    if (command === "") {
      this.finish(args, `Noted: ${args.text}`, [started]);
      return;
    }
    this.sink.ingestProviderEvents(args.threadId, [started]);
    void this.askThenAnswer(args, command);
  }

  // park writes the row before its first await, so the card is up by the time the send answers.
  private async askThenAnswer(args: TurnDriverStartArgs, command: string): Promise<void> {
    const resolution = await this.deps.waiters.park(
      {
        payload: {
          availableDecisions: ["allow_once", "deny"],
          kind: "approval",
          reason: null,
          subject: { command, cwd: null, itemId: `item_${args.turnId}_ask`, kind: "command" },
        },
        providerId: "scripted",
        providerRequestId: `ask_${args.turnId}`,
        providerThreadId: args.threadId,
        threadId: args.threadId,
        turnId: args.turnId,
      },
      args.turnId,
    );
    if (this.deps.disposed()) {
      return;
    }
    if (this.stopping.delete(args.threadId)) {
      this.sink.ingestProviderEvents(args.threadId, [
        {
          scope: turnScope(args.turnId),
          status: "interrupted",
          threadId: args.threadId,
          type: "turn/completed",
        },
      ]);
      return;
    }
    this.finish(args, answerTo(command, resolution));
  }

  // a turn parked on its question is the one a stop can reach: the cancel answers it denied, the
  // card goes, and the turn ends interrupted through the sink.
  interruptTurn(threadId: string): TurnInterrupt {
    if (!this.deps.waiters.hasParked(threadId)) {
      return "not-running";
    }
    this.stopping.add(threadId);
    this.deps.waiters.cancel(threadId);
    interruptOpenPendingInteractions(this.deps.db, this.deps.notifier, threadId);
    return "settling";
  }

  onInteractionResolved(interaction: PendingInteraction): void {
    this.deps.waiters.resolve(interaction);
  }

  // the answer rides with whatever opened the turn, and the settle on its own, as a provider's would.
  private finish(
    args: TurnDriverStartArgs,
    text: string,
    opening: readonly ThreadEvent[] = [],
  ): void {
    const scope = turnScope(args.turnId);
    this.sink.ingestProviderEvents(args.threadId, [
      ...opening,
      ...agentMessageEvents({
        itemId: `item_${args.turnId}_message`,
        scope,
        text,
        threadId: args.threadId,
      }),
    ]);
    this.sink.ingestProviderEvents(args.threadId, [
      { scope, status: "completed", threadId: args.threadId, type: "turn/completed" },
    ]);
  }
}

export const createScriptedTurnDriverFactory =
  (deps: ScriptedDriverDeps): CreateTurnDriver =>
  (sink) =>
    new ScriptedTurnDriver(sink, deps);
