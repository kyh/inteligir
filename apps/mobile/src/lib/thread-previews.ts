// The reply the agent is writing, as the account's socket carries it: never stored and never read
// back, so the phone keeps each thread's text so far, for a screen that reads it as an external
// store, and lets it go once a write moves the thread, since by then its reply landed or its turn
// moved on, or once the socket goes down, since nothing could then say so.

// the text so far of the reply the agent is writing in a thread; or none any more (null) in a
// thread, or in every thread (`threadId` null)
type ThreadPreview =
  | { readonly threadId: string; readonly text: string }
  | { readonly threadId: string | null; readonly text: null };

export interface ThreadPreviews {
  // the text so far of the reply the agent is writing in `threadId`, null while it writes none
  readonly get: (threadId: string) => string | null;
  readonly subscribe: (listener: () => void) => () => void;
  // what the socket said
  readonly hear: (preview: ThreadPreview) => void;
}

export const createThreadPreviews = (): ThreadPreviews => {
  const texts = new Map<string, string>();
  const listeners = new Set<() => void>();
  const changed = (preview: ThreadPreview): boolean => {
    if (preview.text !== null) {
      if (texts.get(preview.threadId) === preview.text) {
        return false;
      }
      texts.set(preview.threadId, preview.text);
      return true;
    }
    if (preview.threadId === null) {
      const held = texts.size > 0;
      texts.clear();
      return held;
    }
    return texts.delete(preview.threadId);
  };
  return {
    get: (threadId) => texts.get(threadId) ?? null,
    hear: (preview) => {
      if (!changed(preview)) {
        return;
      }
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
