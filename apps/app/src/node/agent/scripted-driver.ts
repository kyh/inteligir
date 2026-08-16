// INTELIGIR_AGENT=scripted: an in-process driver with a deterministic
// script, for login-free e2e — every production path around it is real (the
// ingest transaction, the timeline projection, the ws invalidations, the
// vault service write, the agent-attributed commit). The script: stream an
// agent message echoing the user's text, write a note through the VAULT
// SERVICE, report the fileChange item, commit as the agent, complete.

import { turnScope } from "@repo/domain/thread-event-scope";
import type { GitEngine } from "../vault/git";
import type { VaultService } from "../vault/vault-service";
import type {
  CreateTurnDriver,
  ProviderEventSink,
  TurnDriver,
  TurnDriverStartArgs,
} from "../threads/turn-driver";
import { beginAgentTurnCommit } from "./agent-commits";

export interface ScriptedDriverDeps {
  vault: VaultService;
  git: GitEngine;
  onError?: (message: string) => void;
}

export function scriptedNotePath(threadId: string): string {
  return `Agent/${threadId}.md`;
}

class ScriptedTurnDriver implements TurnDriver {
  private readonly sink: ProviderEventSink;
  private readonly deps: ScriptedDriverDeps;
  /** Tests await this to know the async tail (write+commit+complete) landed. */
  lastTurn: Promise<void> = Promise.resolve();

  constructor(sink: ProviderEventSink, deps: ScriptedDriverDeps) {
    this.sink = sink;
    this.deps = deps;
  }

  startTurn(args: TurnDriverStartArgs): void {
    const scope = turnScope(args.turnId);
    const itemId = `item_${args.turnId}_message`;
    const text = `Noted: ${args.text}`;
    const midpoint = Math.ceil(text.length / 2);
    this.sink.ingestProviderEvents(args.threadId, [
      { type: "turn/started", threadId: args.threadId, scope },
      {
        type: "item/started",
        threadId: args.threadId,
        item: { type: "agentMessage", id: itemId, text: "" },
        scope,
      },
      {
        type: "item/agentMessage/delta",
        threadId: args.threadId,
        itemId,
        delta: text.slice(0, midpoint),
        scope,
      },
      {
        type: "item/agentMessage/delta",
        threadId: args.threadId,
        itemId,
        delta: text.slice(midpoint),
        scope,
      },
      {
        type: "item/completed",
        threadId: args.threadId,
        item: { type: "agentMessage", id: itemId, text },
        scope,
      },
    ]);
    this.lastTurn = this.runFileHalf(args, scope);
  }

  private async runFileHalf(
    args: TurnDriverStartArgs,
    scope: ReturnType<typeof turnScope>,
  ): Promise<void> {
    const finishCommit = beginAgentTurnCommit(this.deps.git, args.threadId);
    const fileItemId = `item_${args.turnId}_file`;
    try {
      const notePath = scriptedNotePath(args.threadId);
      const written = await this.deps.vault.write(notePath, `# Agent note\n\n${args.text}\n`);
      this.sink.ingestProviderEvents(args.threadId, [
        {
          type: "item/completed",
          threadId: args.threadId,
          item: {
            type: "fileChange",
            id: fileItemId,
            changes: [{ path: written.path, kind: "add" }],
            status: "completed",
            approvalStatus: null,
          },
          scope,
        },
      ]);
      await finishCommit();
      this.sink.ingestProviderEvents(args.threadId, [
        { type: "turn/completed", threadId: args.threadId, status: "completed", scope },
      ]);
    } catch (error) {
      this.deps.onError?.(error instanceof Error ? error.message : String(error));
      await finishCommit().catch(() => {});
      this.sink.ingestProviderEvents(args.threadId, [
        {
          type: "provider/error",
          threadId: args.threadId,
          message: "Scripted turn failed",
          detail: error instanceof Error ? error.message : String(error),
          scope,
        },
        { type: "turn/completed", threadId: args.threadId, status: "failed", scope },
      ]);
    }
  }

  steerTurn(): boolean {
    return false;
  }
}

export function createScriptedTurnDriverFactory(deps: ScriptedDriverDeps): CreateTurnDriver {
  return (sink) => new ScriptedTurnDriver(sink, deps);
}
