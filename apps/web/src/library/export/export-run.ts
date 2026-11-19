import type { SessionEnd } from "@repo/contract/rpc/call-outcome";
import { saveBlob } from "@repo/ui/lib/save-blob";
import { useEffect, useSyncExternalStore } from "react";

import type { TabSession, TabSessionStore } from "../cloud/library-context";
import { exportNewsSchema } from "./export-news";
import type { ExportAsk, ExportCounts, ExportNews } from "./export-news";

declare global {
  interface Window {
    showSaveFilePicker?: (options: {
      readonly suggestedName: string;
      readonly types: readonly {
        readonly description: string;
        readonly accept: Readonly<Record<string, readonly string[]>>;
      }[];
    }) => Promise<FileSystemFileHandle>;
  }
}

export type ExportRun =
  | { readonly kind: "idle" }
  | { readonly kind: "listing" }
  | { readonly kind: "writing"; readonly written: number; readonly total: number }
  | { readonly kind: "done"; readonly counts: ExportCounts }
  | { readonly kind: "stopped"; readonly written: number }
  | { readonly kind: "failed"; readonly message: string };

type ExportMove =
  | { readonly kind: "start" }
  | { readonly kind: "heard"; readonly news: Exclude<ExportNews, { kind: "session-ended" }> }
  | { readonly kind: "stop" }
  | { readonly kind: "broke" };

export const EXPORT_BROKE =
  "The export couldn't run in this window. Reload the page and try again.";

const IDLE: ExportRun = { kind: "idle" };

type Running = Extract<ExportRun, { kind: "listing" | "writing" }>;

const isRunning = (run: ExportRun): run is Running =>
  run.kind === "listing" || run.kind === "writing";

const afterNews = (news: Extract<ExportMove, { kind: "heard" }>["news"]) => {
  switch (news.kind) {
    case "listing": {
      return { kind: "listing" } satisfies ExportRun;
    }

    case "writing": {
      return { kind: "writing", total: news.total, written: news.written } satisfies ExportRun;
    }

    case "done": {
      return { counts: news.counts, kind: "done" } satisfies ExportRun;
    }

    case "failed": {
      return { kind: "failed", message: news.message } satisfies ExportRun;
    }

    default: {
      throw new Error(`unexpected ${String(news satisfies never)}`);
    }
  }
};

export const exportAfter = (run: ExportRun, move: ExportMove) => {
  if (move.kind === "start") {
    return (isRunning(run) ? run : { kind: "listing" }) satisfies ExportRun;
  }

  if (!isRunning(run)) {
    return run satisfies ExportRun;
  }

  switch (move.kind) {
    case "heard": {
      return afterNews(move.news) satisfies ExportRun;
    }

    case "stop": {
      return {
        kind: "stopped",
        written: run.kind === "writing" ? run.written : 0,
      } satisfies ExportRun;
    }

    case "broke": {
      return { kind: "failed", message: EXPORT_BROKE } satisfies ExportRun;
    }

    default: {
      throw new Error(`unexpected ${String(move satisfies never)}`);
    }
  }
};

export interface ExportTarget {
  readonly ask: ExportAsk;
  readonly name: string;
}

export interface ExportThread {
  readonly send: (ask: ExportAsk) => void;
  readonly close: () => void;
}

export interface ThreadEars {
  readonly heard: (news: ExportNews) => void;
  readonly broke: () => void;
}

export interface ExportHost {
  readonly spawn: (ears: ThreadEars) => ExportThread;
  readonly choose: () => Promise<ExportTarget | null>;
  readonly deliver: (zip: Blob, name: string) => void;
}

export const createExportStore = ({ choose, deliver, spawn }: ExportHost) => {
  const listeners = new Set<() => void>();
  let run: ExportRun = IDLE;
  let thread: ExportThread | null = null;
  let choosing = false;

  const move = (next: ExportMove) => {
    const after = exportAfter(run, next);

    if (after === run) {
      return;
    }

    run = after;

    if (!isRunning(run)) {
      thread?.close();
      thread = null;
    }

    for (const listener of listeners) {
      listener();
    }
  };

  return {
    get: () => run satisfies ExportRun,
    start: async (onSessionEnd: (end: SessionEnd) => void) => {
      if (isRunning(run) || choosing) {
        return;
      }

      choosing = true;
      let target: ExportTarget | null = null;

      try {
        target = await choose();
      } finally {
        choosing = false;
      }

      if (target === null || isRunning(run)) {
        return;
      }

      const { ask, name } = target;
      move({ kind: "start" });

      const started = spawn({
        broke: () => {
          move({ kind: "broke" });
        },
        heard: (news) => {
          if (news.kind === "session-ended") {
            onSessionEnd(news.end);

            return;
          }

          if (news.kind === "done" && news.zip !== null && isRunning(run)) {
            deliver(news.zip, name);
          }

          move({ kind: "heard", news });
        },
      });

      thread = started;
      started.send(ask);
    },
    stop: () => {
      move({ kind: "stop" });
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);

      return (() => {
        listeners.delete(listener);
      }) satisfies () => void;
    },
  };
};

export const exportFileName = (now: Date) => {
  const day = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("-");

  return `Inteligir library ${day}.zip` satisfies string;
};

const chooseTarget = async () => {
  const name = exportFileName(new Date());

  if (window.showSaveFilePicker === undefined) {
    return { ask: { kind: "download" }, name } satisfies ExportTarget | null;
  }

  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: name,
      types: [{ accept: { "application/zip": [".zip"] }, description: "Zip archive" }],
    });

    return { ask: { handle, kind: "file" }, name } satisfies ExportTarget | null;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return null satisfies ExportTarget | null;
    }

    return { ask: { kind: "download" }, name } satisfies ExportTarget | null;
  }
};

const spawnWorker = (ears: ThreadEars) => {
  const worker = new Worker(new URL("export-worker.ts", import.meta.url), {
    name: "export",
    type: "module",
  });

  worker.addEventListener("message", (event) => {
    const news = exportNewsSchema.safeParse(event.data);

    if (news.success) {
      ears.heard(news.data);
    } else {
      ears.broke();
    }
  });
  worker.addEventListener("error", () => {
    ears.broke();
  });

  return {
    close: () => {
      worker.terminate();
    },
    send: (ask) => {
      worker.postMessage(ask, { transfer: [] });
    },
  } satisfies ExportThread;
};

const tabExport = createExportStore({
  choose: chooseTarget,
  deliver: saveBlob,
  spawn: spawnWorker,
});

export const useExportRun = () =>
  useSyncExternalStore(tabExport.subscribe, tabExport.get, tabExport.get) satisfies ExportRun;

export const startExport = tabExport.start;
export const stopExport = tabExport.stop;

export const exportUnloadAsks = (run: ExportRun, session: TabSession) =>
  (session.kind === "live" && isRunning(run)) satisfies boolean;

export const useExportUnloadAsk = (session: TabSessionStore) => {
  useEffect(() => {
    const asksOnUnload = (event: BeforeUnloadEvent) => {
      if (exportUnloadAsks(tabExport.get(), session.get())) {
        event.preventDefault();
      }
    };

    window.addEventListener("beforeunload", asksOnUnload);

    return () => {
      window.removeEventListener("beforeunload", asksOnUnload);
    };
  }, [session]);
};
