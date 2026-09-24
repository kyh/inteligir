import type { ViewContext } from "@repo/domain/view-context";
import type { CreateThreadRequest } from "@repo/api/local/threads/threads-schema";

import { client } from "../api";
import { sendToThread } from "./send-to-thread";
import type { ComposerSendOutcome } from "./send-to-thread";

export interface CreateActionArgs {
  prompt: string;
  contextPaths: readonly string[];
  docPath: string | null;
  viewContext: ViewContext | null;
  // a thread a refused first send already created; minting another on retry leaves an empty action behind.
  threadId: string | null;
}

export interface CreateActionResult {
  threadId: string;
  send: ComposerSendOutcome;
}

// untitled on purpose: the server names a thread from its first message, whoever sent it.
const createActionThread = async (args: CreateActionArgs): Promise<string> => {
  const createBody: CreateThreadRequest = {};
  if (args.docPath !== null) {
    createBody.originDocPath = args.docPath;
  }
  const { thread } = await client.threads.create(createBody);
  return thread.id;
};

export const createAction = async (args: CreateActionArgs): Promise<CreateActionResult> => {
  const threadId = args.threadId ?? (await createActionThread(args));
  const sendArgs: Parameters<typeof sendToThread>[1] = {
    activeTurnId: null,
    contextPaths: args.contextPaths,
    text: args.prompt,
    threadId,
  };
  if (args.viewContext !== null) {
    sendArgs.viewContext = args.viewContext;
  }
  const send = await sendToThread(client, sendArgs);
  return { send, threadId };
};
