import type { ViewContext } from "@repo/domain/view-context";
import type { CreateThreadRequest } from "@repo/api/local/threads/threads-schema";

import type { client } from "../api";
import { sendToThread, type ComposerSendOutcome } from "./send-to-thread";

function actionTitle(prompt: string): string {
  const firstLine = prompt.split("\n", 1)[0]?.trim() ?? "";
  const title = firstLine === "" ? "Action" : firstLine;
  return title.length > 60 ? `${title.slice(0, 59)}…` : title;
}

export interface CreateActionArgs {
  prompt: string;
  // ride the send as a leading context line; the agent reads the files itself.
  contextPaths?: string[];
  docPath: string | null;
  viewContext: ViewContext | null;
  // a thread a refused first send already created; minting another on retry leaves an empty action behind.
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
