// echoes the composed prompt rather than the raw text: the prompt is assembled by production
// code a real provider would receive and an e2e otherwise cannot see.

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
  onError?: (message: string) => void;
}

export const scriptedNotePath = (threadId: string): string => `Agent/${threadId}.md`;

class ScriptedTurnDriver implements TurnDriver {
  private readonly sink: ProviderEventSink;
  private readonly deps: ScriptedDriverDeps;
  // tests await this to know the async tail (write, commit, complete) landed.
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
      { scope, threadId: args.threadId, type: "turn/started" },
      ...agentMessageEvents({ itemId, scope, text, threadId: args.threadId }),
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
      // waits out a mid-flight sync so the write never lands in a rebase window.
      await turnCommit.ready;
      const notePath = scriptedNotePath(args.threadId);
      const written = await this.deps.vault.write(notePath, `# Agent note\n\n${args.text}\n`);
      turnCommit.recordPaths([written.path]);
      this.sink.ingestProviderEvents(args.threadId, [
        {
          item: {
            approvalStatus: null,
            changes: [{ kind: "add", path: written.path }],
            id: fileItemId,
            status: "completed",
            type: "fileChange",
          },
          scope,
          threadId: args.threadId,
          type: "item/completed",
        },
      ]);
      await turnCommit.finish();
      this.sink.ingestProviderEvents(args.threadId, [
        { scope, status: "completed", threadId: args.threadId, type: "turn/completed" },
      ]);
    } catch (error) {
      this.deps.onError?.(error instanceof Error ? error.message : String(error));
      await turnCommit.finish().catch(() => {
        /* empty */
      });
      this.sink.ingestProviderEvents(args.threadId, [
        {
          detail: error instanceof Error ? error.message : String(error),
          message: "Scripted turn failed",
          scope,
          threadId: args.threadId,
          type: "provider/error",
        },
        { scope, status: "failed", threadId: args.threadId, type: "turn/completed" },
      ]);
    }
  }
}

export const createScriptedTurnDriverFactory =
  (deps: ScriptedDriverDeps): CreateTurnDriver =>
  (sink) =>
    new ScriptedTurnDriver(sink, deps);
