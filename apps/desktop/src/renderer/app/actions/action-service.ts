// Creating an ACTION: one thread, attached to the note it was composed over
// (originDocPath alone — no anchor into the bytes),
// first message sent in the same breath. The view context rides the send, not
// the thread, per the view-context decision.

import type { ViewContext } from "@repo/domain/view-context";
import type { CreateThreadRequest } from "@repo/api/local/threads/threads-schema";

import type { client } from "../api";
import { sendToThread, type ComposerSendOutcome } from "./send-to-thread";

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
  /** A thread a refused first send already created; null mints one. Given,
   * the send lands in it: minting another on retry would leave an empty
   * action behind every refusal. */
  threadId: string | null;
}

export interface CreateActionResult {
  threadId: string;
  send: ComposerSendOutcome;
}

async function createActionThread(api: typeof client, args: CreateActionArgs): Promise<string> {
  const createBody: CreateThreadRequest = { title: actionTitle(args.prompt) };
  if (args.docPath !== null) {
    createBody.originDocPath = args.docPath;
  }
  const { thread } = await api.threads.create(createBody);
  return thread.id;
}

export async function createAction(
  api: typeof client,
  args: CreateActionArgs,
): Promise<CreateActionResult> {
  const threadId = args.threadId ?? (await createActionThread(api, args));
  const contextPaths = args.contextPaths ?? [];
  const text =
    contextPaths.length === 0
      ? args.prompt
      : `Context notes: ${contextPaths.join(", ")}\n\n${args.prompt}`;
  const sendArgs: Parameters<typeof sendToThread>[1] = {
    activeTurnId: null,
    text,
    threadId,
  };
  if (args.viewContext !== null) {
    sendArgs.viewContext = args.viewContext;
  }
  const send = await sendToThread(api, sendArgs);
  return { send, threadId };
}
