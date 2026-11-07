// The shares the inbox settles (`./share-inbox`), one at a time, the latest last. The share
// context holds one intent and replaces it when another share arrives, and a settle can run for
// tens of seconds (the page's fetch alone may take 20), so a share made meanwhile is settled once
// the one before it is done, and the context is let go only once the intent just settled is still
// the one it holds: a reset after the first would clear the second unsaved. A share the library
// left under is held in the context, for the sign-in after to settle.

interface ShareQueuePorts<T> {
  // saves the share and opens its item; it never throws
  readonly settle: (intent: T) => Promise<"settled" | "held">;
  // lets the context's intent go
  readonly reset: () => void;
}

export interface ShareQueue<T> {
  // the intent the context holds now, or null for none, with the ports the screen holds now
  readonly offer: (intent: T | null, ports: ShareQueuePorts<T>) => void;
}

export const createShareQueue = <T>(): ShareQueue<T> => {
  let held: T | null = null;
  let latest: ShareQueuePorts<T> | null = null;
  let draining = false;

  // each settle and reset through the ports the screen offered last
  const drain = async (): Promise<void> => {
    draining = true;
    try {
      for (;;) {
        const intent = held;
        if (intent === null || latest === null) {
          return;
        }
        if ((await latest.settle(intent)) === "held") {
          return;
        }
        if (held === intent) {
          held = null;
          latest.reset();
        }
      }
    } finally {
      draining = false;
    }
  };

  return {
    offer: (intent, ports) => {
      held = intent;
      latest = ports;
      if (intent !== null && !draining) {
        void drain();
      }
    },
  };
};
