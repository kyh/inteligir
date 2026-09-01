// INTELIGIR_AGENT=scripted: an in-process driver with a deterministic
// script, for login-free e2e — every production path around it is real (the
// ingest transaction, the timeline projection, the ws invalidations, the
// vault service write, the settling of the turn's write set). The script:
// stream an agent message echoing THE PROMPT IT WAS HANDED, write a note
// through the VAULT SERVICE, report the fileChange item, settle the write set
// (an agent-attributed commit), complete.
//
// The echo is the prompt rather than the raw text because the prompt is
// assembled by production code (`turnPromptInput`) that a real provider would
// receive and an e2e otherwise cannot see. With no view context the two are
// the same string, so nothing about the older scenarios moves.

import { turnScope } from "@repo/domain/thread-event-scope";
import type { GitEngine } from "../vault/git-engine";
import type { VaultService } from "../vault/vault-service";
import type {
  CreateTurnDriver,
  ProviderEventSink,
  TurnDriver,
  TurnDriverStartArgs,
} from "../threads/turn-driver";
import { beginAgentTurnWrites } from "./agent-commits";
import { agentMessageEvents } from "./agent-message-events";
import { turnPromptInput } from "./view-context-prompt";

export interface ScriptedDriverDeps {
  vault: VaultService;
  git: GitEngine;
  /** Where a failed scripted turn reports itself, same as the ACP manager's. */
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
    const prompt = turnPromptInput(args.text, args.viewContext)
      .map((part) => part.text)
      .join("\n\n");
    const text = `Noted: ${prompt}`;
    this.sink.ingestProviderEvents(args.threadId, [
      { type: "turn/started", threadId: args.threadId, scope },
      ...agentMessageEvents({ threadId: args.threadId, itemId, text, scope }),
    ]);
    this.lastTurn = this.runFileHalf(args, scope);
  }

  private async runFileHalf(
    args: TurnDriverStartArgs,
    scope: ReturnType<typeof turnScope>,
  ): Promise<void> {
    const turnCommit = beginAgentTurnWrites({
      git: this.deps.git,
      threadId: args.threadId,
      turnId: args.turnId,
    });
    const fileItemId = `item_${args.turnId}_file`;
    try {
      // Wait out any mid-flight sync before writing (same barrier the ACP
      // manager takes), so the write never lands in a rebase window.
      await turnCommit.ready;
      const notePath = scriptedNotePath(args.threadId);
      const written = await this.deps.vault.write(notePath, `# Agent note\n\n${args.text}\n`);
      turnCommit.recordPaths([written.path]);
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
      await turnCommit.finish();
      this.sink.ingestProviderEvents(args.threadId, [
        { type: "turn/completed", threadId: args.threadId, status: "completed", scope },
      ]);
    } catch (error) {
      this.deps.onError?.(error instanceof Error ? error.message : String(error));
      await turnCommit.finish().catch(() => {});
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
}

export function createScriptedTurnDriverFactory(deps: ScriptedDriverDeps): CreateTurnDriver {
  return (sink) => new ScriptedTurnDriver(sink, deps);
}
