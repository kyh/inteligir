// The tab's one import, a value moved by `importAfter` alone: idle, reading the file, landing its
// items, or ended done, stopped or failed. A run reads on a thread of its own (`./import-worker`),
// which Stop and every end close; it lives as long as the tab, so Settings can close and open again
// on it, and closing the tab ends it.

import type { SessionEnd } from "@repo/contract/library/call-outcome";
import { useSyncExternalStore } from "react";

import { importNewsSchema } from "./import-news";
import type { ImportAsk, ImportCounts, ImportNews, ImportSource } from "./import-news";

export type ImportRun =
  | { readonly kind: "idle" }
  | { readonly kind: "reading"; readonly source: ImportSource }
  | {
      readonly kind: "landing";
      readonly source: ImportSource;
      readonly counts: ImportCounts;
      readonly total: number;
    }
  | { readonly kind: "done"; readonly counts: ImportCounts }
  | { readonly kind: "stopped"; readonly counts: ImportCounts }
  | { readonly kind: "failed"; readonly counts: ImportCounts; readonly message: string };

type ImportMove =
  | { readonly kind: "start"; readonly source: ImportSource }
  | { readonly kind: "heard"; readonly news: Exclude<ImportNews, { kind: "session-ended" }> }
  | { readonly kind: "stop" }
  // the thread itself failed: its script did not load, or it threw past its own reading
  | { readonly kind: "broke" };

export const IMPORT_BROKE =
  "The import couldn't run in this window. Reload the page and try again.";

const NONE: ImportCounts = { added: 0, alreadySaved: 0, unreadable: 0 };

const IDLE: ImportRun = { kind: "idle" };

type Running = Extract<ImportRun, { kind: "reading" | "landing" }>;

const isRunning = (run: ImportRun): run is Running =>
  run.kind === "reading" || run.kind === "landing";

const countsOf = (run: Running): ImportCounts => (run.kind === "landing" ? run.counts : NONE);

const afterNews = (
  run: Running,
  news: Extract<ImportMove, { kind: "heard" }>["news"],
): ImportRun => {
  switch (news.kind) {
    case "reading": {
      return { kind: "reading", source: run.source };
    }
    case "landing": {
      return { counts: news.counts, kind: "landing", source: run.source, total: news.total };
    }
    case "done": {
      return { counts: news.counts, kind: "done" };
    }
    case "failed": {
      return { counts: news.counts, kind: "failed", message: news.message };
    }
    // no default
  }
};

export const importAfter = (run: ImportRun, move: ImportMove): ImportRun => {
  if (move.kind === "start") {
    return isRunning(run) ? run : { kind: "reading", source: move.source };
  }
  if (!isRunning(run)) {
    return run;
  }
  switch (move.kind) {
    case "heard": {
      return afterNews(run, move.news);
    }
    case "stop": {
      return { counts: countsOf(run), kind: "stopped" };
    }
    case "broke": {
      return { counts: countsOf(run), kind: "failed", message: IMPORT_BROKE };
    }
    // no default
  }
};

// the thread a run reads on, as the store reaches it
export interface ImportThread {
  readonly send: (ask: ImportAsk) => void;
  readonly close: () => void;
}

export interface ThreadEars {
  readonly heard: (news: ImportNews) => void;
  readonly broke: () => void;
}

export const createImportStore = (spawn: (ears: ThreadEars) => ImportThread) => {
  const listeners = new Set<() => void>();
  let run: ImportRun = IDLE;
  let thread: ImportThread | null = null;
  const move = (next: ImportMove): void => {
    const after = importAfter(run, next);
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
    get: (): ImportRun => run,
    start: (ask: ImportAsk, onSessionEnd: (end: SessionEnd) => void): void => {
      if (isRunning(run)) {
        return;
      }
      move({ kind: "start", source: ask.source });
      const started = spawn({
        broke: () => {
          move({ kind: "broke" });
        },
        heard: (news) => {
          if (news.kind === "session-ended") {
            onSessionEnd(news.end);
          } else {
            move({ kind: "heard", news });
          }
        },
      });
      thread = started;
      started.send(ask);
    },
    stop: (): void => {
      move({ kind: "stop" });
    },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

const spawnWorker = (ears: ThreadEars): ImportThread => {
  const worker = new Worker(new URL("import-worker.ts", import.meta.url), {
    name: "import",
    type: "module",
  });
  worker.addEventListener("message", (event) => {
    const news = importNewsSchema.safeParse(event.data);
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
  };
};

const tabImport = createImportStore(spawnWorker);

export const useImportRun = (): ImportRun =>
  useSyncExternalStore(tabImport.subscribe, tabImport.get, tabImport.get);

export const startImport = tabImport.start;
export const stopImport = tabImport.stop;
