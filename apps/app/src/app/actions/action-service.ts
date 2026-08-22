// Creating an ACTION: one thread, attached to the note it was composed over
// (originDocPath, no anchor — markers retired with the delegation surface),
// first message sent in the same breath. The view context rides the send, not
// the thread, per the view-context decision.

import type { ViewContext } from "@repo/domain/view-context";
import type { ApiClient } from "@repo/server-contract/client";
import type { CreateThreadRequest } from "@repo/server-contract/threads";

import { sendToThread, type ComposerSendOutcome } from "../chat/chat-service";

/** First line of the prompt, trimmed to a title-sized span. */
function actionTitle(prompt: string): string {
  const firstLine = prompt.split("\n", 1)[0]?.trim() ?? "";
  const title = firstLine === "" ? "Action" : firstLine;
  return title.length > 60 ? `${title.slice(0, 59)}…` : title;
}

export interface CreateActionArgs {
  prompt: string;
  /** Vault paths the user @-mentioned. They ride the send as a leading
   * context line — the agent reads the files itself, nothing is inlined —
   * and stay out of the title, which is the user's own words. */
  contextPaths?: string[];
  /** The note this action is about; null composes an unattached action. */
  docPath: string | null;
  viewContext: ViewContext | null;
}

export interface CreateActionResult {
  threadId: string;
  send: ComposerSendOutcome;
}

export async function createAction(
  api: ApiClient,
  args: CreateActionArgs,
): Promise<CreateActionResult> {
  const createBody: CreateThreadRequest = { title: actionTitle(args.prompt) };
  if (args.docPath !== null) {
    createBody.originDocPath = args.docPath;
  }
  const created = await api.threads.create.$post({ json: createBody });
  if (!created.ok) {
    throw new Error("Could not create the action");
  }
  const { thread } = await created.json();
  const contextPaths = args.contextPaths ?? [];
  const text =
    contextPaths.length === 0
      ? args.prompt
      : `Context notes: ${contextPaths.join(", ")}\n\n${args.prompt}`;
  const sendArgs: Parameters<typeof sendToThread>[1] = {
    activeTurnId: null,
    text,
    threadId: thread.id,
  };
  if (args.viewContext !== null) {
    sendArgs.viewContext = args.viewContext;
  }
  const send = await sendToThread(api, sendArgs);
  return { send, threadId: thread.id };
}
