// The reply the agent is writing, as the account's socket carries it: a preview is never stored and
// never read back, so each device folds the frames it hears into the text so far, by thread, and lets
// it go once a stored event of that thread arrives (the reply landed, or the turn moved on). A
// preview this build cannot parse changes nothing.

import { agentPreviewSchema } from "@repo/contract/library/agent-events";
import type { LibrarySocketFrame } from "@repo/contract/library/library-socket";

export type ThreadFrame = Extract<LibrarySocketFrame, { type: "thread" }>;

// what one frame does to its thread's reply: the text so far, or none any more (null); null for a
// frame that changes nothing
export const previewOf = (
  frame: ThreadFrame,
): { readonly threadId: string; readonly text: string | null } | null => {
  if (!frame.preview) {
    return { text: null, threadId: frame.threadId };
  }
  const parsed = agentPreviewSchema.safeParse(frame.event);
  return parsed.success ? { text: parsed.data.text, threadId: frame.threadId } : null;
};

export interface ThreadPreviews {
  // the text so far of the reply the agent is writing in `threadId`, null while it writes none
  readonly get: (threadId: string) => string | null;
  readonly subscribe: (listener: () => void) => () => void;
  readonly stop: () => void;
}

// every thread's reply being written, over the account socket's thread frames, for a screen that
// reads it
// as an external store
export const createThreadPreviews = (
  onThreadFrame: (listener: (frame: ThreadFrame) => void) => () => void,
): ThreadPreviews => {
  const texts = new Map<string, string>();
  const listeners = new Set<() => void>();
  const stop = onThreadFrame((frame) => {
    const preview = previewOf(frame);
    if (preview === null || (texts.get(preview.threadId) ?? null) === preview.text) {
      return;
    }
    if (preview.text === null) {
      texts.delete(preview.threadId);
    } else {
      texts.set(preview.threadId, preview.text);
    }
    for (const listener of listeners) {
      listener();
    }
  });
  return {
    get: (threadId) => texts.get(threadId) ?? null,
    stop,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
