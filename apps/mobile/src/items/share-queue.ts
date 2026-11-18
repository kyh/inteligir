interface ShareQueuePorts<T> {
  readonly settle: (intent: T) => Promise<"settled" | "held">;
  readonly reset: () => void;
}

interface ShareQueue<T> {
  readonly offer: (intent: T | null, ports: ShareQueuePorts<T>) => void;
}

export const createShareQueue = <T>() => {
  let held: T | null = null;
  let latest: ShareQueuePorts<T> | null = null;
  let draining = false;

  const drain = async () => {
    draining = true;

    try {
      for (;;) {
        const intent = held;

        if (intent === null || latest === null) {
          return;
        }

        const ports = latest;

        if ((await ports.settle(intent)) === "held") {
          if (latest === ports) {
            return;
          }
        } else if (held === intent) {
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
  } satisfies ShareQueue<T>;
};
