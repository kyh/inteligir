// The tab's one export, a value moved by `exportAfter` alone: idle, listing the library, writing
// its items, or ended done, stopped or failed. A run writes on a thread of its own
// (`./export-worker`), which Stop and every end close; it lives as long as the tab, so Settings can
// close and open again on it, and closing the tab ends it, which the browser asks about first while
// it runs. Where the browser has a save picker (Chromium's), the zip streams into the file the
// person chose there; elsewhere, the Mac app's window among them, it comes back whole and is
// downloaded as a file item's Download is (`@repo/ui/lib/save-blob`).

import type { SessionEnd } from "@repo/contract/rpc/call-outcome";
import { saveBlob } from "@repo/ui/lib/save-blob";
import { useEffect, useSyncExternalStore } from "react";

import type { TabSession, TabSessionStore } from "../cloud/library-context";
import { exportNewsSchema } from "./export-news";
import type { ExportAsk, ExportCounts, ExportNews } from "./export-news";

declare global {
  interface Window {
    // Chromium's (https://wicg.github.io/file-system-access/#api-showsavefilepicker); WebKit and
    // Firefox have none
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
  // the thread itself failed: its script did not load, or it threw past its own writing
  | { readonly kind: "broke" };

export const EXPORT_BROKE =
  "The export couldn't run in this window. Reload the page and try again.";

const IDLE: ExportRun = { kind: "idle" };

type Running = Extract<ExportRun, { kind: "listing" | "writing" }>;

const isRunning = (run: ExportRun): run is Running =>
  run.kind === "listing" || run.kind === "writing";

const afterNews = (news: Extract<ExportMove, { kind: "heard" }>["news"]): ExportRun => {
  switch (news.kind) {
    case "listing": {
      return { kind: "listing" };
    }
    case "writing": {
      return { kind: "writing", total: news.total, written: news.written };
    }
    case "done": {
      return { counts: news.counts, kind: "done" };
    }
    case "failed": {
      return { kind: "failed", message: news.message };
    }
    // no default
  }
};

export const exportAfter = (run: ExportRun, move: ExportMove): ExportRun => {
  if (move.kind === "start") {
    return isRunning(run) ? run : { kind: "listing" };
  }
  if (!isRunning(run)) {
    return run;
  }
  switch (move.kind) {
    case "heard": {
      return afterNews(move.news);
    }
    case "stop": {
      return { kind: "stopped", written: run.kind === "writing" ? run.written : 0 };
    }
    case "broke": {
      return { kind: "failed", message: EXPORT_BROKE };
    }
    // no default
  }
};

// where a run's zip goes, and the name it is saved under
export interface ExportTarget {
  readonly ask: ExportAsk;
  readonly name: string;
}

// the thread a run writes on, as the store reaches it
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
  // where the zip goes, null once the person closed the picker without choosing
  readonly choose: () => Promise<ExportTarget | null>;
  // a zip that came back whole, handed to the browser's download
  readonly deliver: (zip: Blob, name: string) => void;
}

export const createExportStore = ({ choose, deliver, spawn }: ExportHost) => {
  const listeners = new Set<() => void>();
  let run: ExportRun = IDLE;
  let thread: ExportThread | null = null;
  let choosing = false;
  const move = (next: ExportMove): void => {
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
    get: (): ExportRun => run,
    start: async (onSessionEnd: (end: SessionEnd) => void): Promise<void> => {
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

// "Inteligir library 2026-11-19.zip", by the day on this device
export const exportFileName = (now: Date): string => {
  const day = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("-");
  return `Inteligir library ${day}.zip`;
};

// The picker opens from the click itself, which it needs; a picker this window may not open, a
// frame's or one asked too long after the click, leaves the download
const chooseTarget = async (): Promise<ExportTarget | null> => {
  const name = exportFileName(new Date());
  if (window.showSaveFilePicker === undefined) {
    return { ask: { kind: "download" }, name };
  }
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: name,
      types: [{ accept: { "application/zip": [".zip"] }, description: "Zip archive" }],
    });
    return { ask: { handle, kind: "file" }, name };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return null;
    }
    return { ask: { kind: "download" }, name };
  }
};

const spawnWorker = (ears: ThreadEars): ExportThread => {
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
  };
};

const tabExport = createExportStore({
  choose: chooseTarget,
  deliver: saveBlob,
  spawn: spawnWorker,
});

export const useExportRun = (): ExportRun =>
  useSyncExternalStore(tabExport.subscribe, tabExport.get, tabExport.get);

export const startExport = tabExport.start;
export const stopExport = tabExport.stop;

// whether the browser asks as the tab closes or reloads: only while a run lists or writes, which
// the close ends, and never once the session ended, whose way to the sign-in a prompt would hold up
export const exportUnloadAsks = (run: ExportRun, session: TabSession): boolean =>
  session.kind === "live" && isRunning(run);

// the browser's ask, for as long as the library is open rather than Settings, which a run outlives
export const useExportUnloadAsk = (session: TabSessionStore): void => {
  useEffect(() => {
    const asksOnUnload = (event: BeforeUnloadEvent): void => {
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
