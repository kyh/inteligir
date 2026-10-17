// echoes the composed prompt rather than the raw text: the prompt is assembled by production
// code a real provider would receive and an e2e otherwise cannot see. A line of the typed text that
// reads `save <web link or absolute path>` saves it inside the turn, as a real agent's shell would
// through `inteligir save`: the scripted driver hears no shell, so this is how an e2e proves that
// an agent's save joins its turn's commit and leaves with its Undo.

import { readFile } from "node:fs/promises";
import nodePath from "node:path";
import type { DbNotifier } from "@repo/domain/notifier";
import { isWebUrl } from "@repo/notes/items/item-url";
import { turnScope } from "@repo/domain/thread-event-scope";
import { messageOf } from "../error-message";
import type { ItemsService } from "../items/items-service";
import type { GitEngine } from "../vault/git-engine";
import type { VaultService } from "../vault/vault-service";
import type {
  ProviderEventSink,
  TurnDriver,
  TurnDriverStartArgs,
  TurnInterrupt,
} from "../threads/turn-driver";
import { beginAgentTurnWrites } from "./agent-commits";
import type { PromptFacts } from "./action-preset-prompt";
import { agentMessageEvents } from "./agent-message-events";
import { turnPromptInput } from "./view-context-prompt";

export interface ScriptedDriverDeps {
  vault: VaultService;
  git: GitEngine;
  // what a `save <target>` line of the turn's text saves through, inside the turn
  items: Pick<ItemsService, "saveLink" | "saveFile">;
  // read per turn, as a real session's prompt is composed
  promptFacts: () => PromptFacts;
  notifier: DbNotifier;
  onError?: (message: string) => void;
}

export const scriptedNotePath = (threadId: string): string => `Agent/${threadId}.md`;

const SAVE_LINE = /^save\s+(?<target>\S.*)$/u;

// the targets of the text's `save` lines: a web link, or a file named by its absolute path
const saveTargets = (text: string): string[] =>
  text.split(/\r?\n/u).flatMap((line) => {
    const target = SAVE_LINE.exec(line.trim())?.groups?.["target"]?.trim();
    return target !== undefined && (isWebUrl(target) || nodePath.isAbsolute(target))
      ? [target]
      : [];
  });

export class ScriptedTurnDriver implements TurnDriver {
  private readonly sink: ProviderEventSink;
  private readonly deps: ScriptedDriverDeps;

  constructor(sink: ProviderEventSink, deps: ScriptedDriverDeps) {
    this.sink = sink;
    this.deps = deps;
  }

  startTurn(args: TurnDriverStartArgs): void {
    const scope = turnScope(args.turnId);
    const itemId = `item_${args.turnId}_message`;
    const prompt = turnPromptInput(args, this.deps.promptFacts())
      .map((part) => part.text)
      .join("\n\n");
    const text = `Noted: ${prompt}`;
    this.sink.ingestProviderEvents(args.threadId, [
      { scope, threadId: args.threadId, type: "turn/started" },
      ...agentMessageEvents({ itemId, scope, text, threadId: args.threadId }),
    ]);
    void this.runFileHalf(args, scope);
  }

  // every path a save wrote: the stub, a file item's wrapper and original, a cover
  private async save(target: string): Promise<string[]> {
    if (isWebUrl(target)) {
      const saved = await this.deps.items.saveLink({ keepCopy: false, url: target, wait: true });
      return saved.wrote;
    }
    const bytes = await readFile(target);
    const saved = await this.deps.items.saveFile({
      file: new Blob([bytes]),
      name: nodePath.basename(target),
    });
    return saved.wrote;
  }

  // a scripted turn has no provider to cancel, and its file half always reports the turn's end.
  // oxlint-disable-next-line class-methods-use-this -- the TurnDriver's instance API: the service calls it on the driver it was handed
  interruptTurn(): TurnInterrupt {
    return "settling";
  }

  private async runFileHalf(
    args: TurnDriverStartArgs,
    scope: ReturnType<typeof turnScope>,
  ): Promise<void> {
    const turnCommit = beginAgentTurnWrites({
      git: this.deps.git,
      notifier: this.deps.notifier,
      onError: (message) => {
        this.deps.onError?.(message);
      },
      threadId: args.threadId,
      turnId: args.turnId,
    });
    const fileItemId = `item_${args.turnId}_file`;
    try {
      // waits out a mid-flight sync so the write never lands in a rebase window, and the
      // checkpoint so the turn's commit never carries what the user had not yet committed.
      await turnCommit.ready;
      const notePath = scriptedNotePath(args.threadId);
      const written = await this.deps.vault.write(notePath, `# Agent note\n\n${args.text}\n`);
      turnCommit.recordPaths([written.path]);
      const saved: string[] = [];
      for (const target of saveTargets(args.text)) {
        const wrote = await this.save(target);
        turnCommit.recordPaths(wrote);
        saved.push(...wrote.filter((path) => !saved.includes(path)));
      }
      this.sink.ingestProviderEvents(args.threadId, [
        {
          item: {
            approvalStatus: null,
            changes: [written.path, ...saved].map((path) => ({ kind: "add" as const, path })),
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
      const detail = messageOf(error);
      this.deps.onError?.(detail);
      await turnCommit.finish().catch(() => {
        /* empty */
      });
      this.sink.ingestProviderEvents(args.threadId, [
        {
          detail,
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
