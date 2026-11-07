// The native end of the phone page's headless mode, the WebView nothing shows and the one place the
// phone runs the editor's code with no editor drawn: the page says `ready`, the host stamps a fresh
// nonce on an `init` in headless mode, and hands it each page the share sheet fetched to read as a
// `fillJob`, and each block a CONFLICT left two devices' changes on to merge as a `mergeJob`, each
// matched to its answer by id. A frame counts only from the page's own document and under this
// load's nonce, as the editor's host holds them (editor-host.ts). A job waits for the page; one it
// has not answered in 30 s (a page that wedged the reader), or one held when the page went away,
// fails, and the page loads again, so the jobs behind it meet a fresh page. Pure: the component
// attaches the WebView, and the suite drives every frame.

import { nativeFrameScript, parsePageFrame } from "@repo/editor-bridge/protocol";
import type { FillAnswer, FillJob, MergeSides, NativeFrame } from "@repo/editor-bridge/protocol";
import type { MergedBlock } from "@repo/library-replica/replica-ports";
import { sameDocument } from "../lib/same-document";

interface ReaderView {
  injectJavaScript: (script: string) => void;
  reload: () => void;
}

export interface HeadlessPageHostArgs {
  // the page's own address: a frame from any other document is dropped
  pageUrl: string;
  mintNonce: () => string;
  setTimer?: (ms: number, run: () => void) => () => void;
}

export interface HeadlessPageHost {
  // the WebView, as a callback ref hands it over; null once it is gone, and its jobs with it
  attach: (view: ReaderView | null) => void;
  // a message the WebView delivered, with the address of the document that sent it
  receive: (message: { data: string; url: string }) => void;
  read: (job: FillJob) => Promise<FillAnswer>;
  // the editor's merge of a block two devices changed; rejects when the page could not merge it
  merge: (sides: MergeSides) => Promise<MergedBlock>;
  // iOS killed the page's content process: its jobs fail and the page loads again
  reload: () => void;
}

const JOB_TIMEOUT_MS = 30_000;

const PAGE_GONE = "the headless page went away before it answered";

type Work =
  | { readonly kind: "fill"; readonly job: FillJob; readonly resolve: (answer: FillAnswer) => void }
  | {
      readonly kind: "merge";
      readonly sides: MergeSides;
      readonly resolve: (merged: MergedBlock) => void;
    };

interface Job {
  id: number;
  work: Work;
  reject: (error: Error) => void;
  cancelTimer: () => void;
  sent: boolean;
}

const defaultTimer = (ms: number, run: () => void): (() => void) => {
  const timer = setTimeout(run, ms);
  return () => {
    clearTimeout(timer);
  };
};

export const createHeadlessPageHost = (args: HeadlessPageHostArgs): HeadlessPageHost => {
  const setTimer = args.setTimer ?? defaultTimer;
  const jobs = new Map<number, Job>();
  let view: ReaderView | null = null;
  let nonce: string | null = null;
  let nextId = 0;

  const deliver = (frame: NativeFrame): void => {
    view?.injectJavaScript(nativeFrameScript(frame));
  };

  const send = (entry: Job): void => {
    if (nonce === null || entry.sent) {
      return;
    }
    entry.sent = true;
    const { work } = entry;
    deliver(
      work.kind === "fill"
        ? { id: entry.id, job: work.job, nonce, type: "fillJob" }
        : { id: entry.id, nonce, sides: work.sides, type: "mergeJob" },
    );
  };

  const failAll = (reason: string): void => {
    const failing = [...jobs.values()];
    jobs.clear();
    for (const entry of failing) {
      entry.cancelTimer();
      entry.reject(new Error(reason));
    }
  };

  // the page that was loaded holds nothing now
  const forget = (): void => {
    nonce = null;
    failAll(PAGE_GONE);
  };

  const reload = (): void => {
    forget();
    view?.reload();
  };

  // a job held until the page answers it, or fails past its time and loads the page again
  const queue = (work: Work, reject: (error: Error) => void): void => {
    const id = nextId;
    nextId += 1;
    const entry: Job = {
      cancelTimer: setTimer(JOB_TIMEOUT_MS, () => {
        jobs.delete(id);
        reject(new Error(`the headless page did not answer within ${String(JOB_TIMEOUT_MS)}ms`));
        reload();
      }),
      id,
      reject,
      sent: false,
      work,
    };
    jobs.set(id, entry);
    send(entry);
  };

  return {
    attach: (next) => {
      if (next === null) {
        forget();
      }
      view = next;
    },

    merge: async (sides) =>
      // oxlint-disable-next-line promise/avoid-new -- the page answers as a frame, which only a promise can hand to an await
      await new Promise<MergedBlock>((resolve, reject) => {
        queue({ kind: "merge", resolve, sides }, reject);
      }),

    read: async (job) =>
      // oxlint-disable-next-line promise/avoid-new -- the page answers as a frame, which only a promise can hand to an await
      await new Promise<FillAnswer>((resolve, reject) => {
        queue({ job, kind: "fill", resolve }, reject);
      }),

    receive: ({ data, url }) => {
      if (!sameDocument(url, args.pageUrl)) {
        return;
      }
      const frame = parsePageFrame(data);
      if (frame === null) {
        return;
      }
      if (frame.type === "ready") {
        // a fresh load: whatever the last one held is gone, and what waits goes to this one
        nonce = args.mintNonce();
        for (const entry of jobs.values()) {
          entry.sent = false;
        }
        deliver({ mode: "headless", nonce, type: "init" });
        for (const entry of jobs.values()) {
          send(entry);
        }
        return;
      }
      if ((frame.type !== "fillAnswer" && frame.type !== "mergeAnswer") || frame.nonce !== nonce) {
        return;
      }
      const entry = jobs.get(frame.id);
      if (entry === undefined) {
        return;
      }
      jobs.delete(frame.id);
      entry.cancelTimer();
      const { work } = entry;
      if (frame.type === "fillAnswer" && work.kind === "fill") {
        work.resolve(frame.answer);
      } else if (frame.type === "mergeAnswer" && work.kind === "merge" && frame.merged !== null) {
        work.resolve(frame.merged);
      } else {
        entry.reject(new Error("the headless page answered another job, or could not merge"));
      }
    },

    reload,
  };
};
