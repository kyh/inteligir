import { client } from "../api";
import { sendToThread } from "./send-to-thread";
import type { ComposerSendOutcome } from "./send-to-thread";

export interface CreateActionArgs {
  prompt: string;
  // a thread a refused first send already created; minting another on retry leaves an empty action behind.
  threadId: string | null;
}

export interface CreateActionResult {
  threadId: string;
  send: ComposerSendOutcome;
}

// untitled on purpose: the server names a thread from its first message, whoever sent it.
const createActionThread = async (): Promise<string> => {
  const { thread } = await client.threads.create({});
  return thread.id;
};

export const createAction = async (args: CreateActionArgs): Promise<CreateActionResult> => {
  const threadId = args.threadId ?? (await createActionThread());
  const send = await sendToThread(client, { activeTurnId: null, text: args.prompt, threadId });
  return { send, threadId };
};
