// The native end of the phone page's reader mode, the WebView nothing shows: the page says `ready`,
// the host stamps a fresh nonce on an `init` in fill mode, and hands it each page to read as a
// `fillJob`, matched to its `fillAnswer` by id. A frame counts only from the page's own document
// and under this load's nonce, as the editor's host holds them (editor-host.ts). A job waits for
// the page; one it has not answered in 30 s (a page that wedged the reader), or one held when the
// page went away, fails, and the page loads again, so the jobs behind it meet a fresh reader. Pure:
// the component attaches the WebView, and the suite drives every frame.

import { nativeFrameScript, parsePageFrame } from "@repo/mobile-editor/bridge-protocol";
import type { FillAnswer, FillJob, NativeFrame } from "@repo/mobile-editor/bridge-protocol";
import { sameDocument } from "../lib/same-document";

interface ReaderView {
  injectJavaScript: (script: string) => void;
  reload: () => void;
}

export interface FillPageHostArgs {
  // the page's own address: a frame from any other document is dropped
  pageUrl: string;
  mintNonce: () => string;
  jobTimeoutMs?: number;
  setTimer?: (ms: number, run: () => void) => () => void;
}

export interface FillPageHost {
  // the WebView, as a callback ref hands it over; null once it is gone, and its jobs with it
  attach: (view: ReaderView | null) => void;
  // a message the WebView delivered, with the address of the document that sent it
  receive: (message: { data: string; url: string }) => void;
  read: (job: FillJob) => Promise<FillAnswer>;
  // iOS killed the page's content process: its jobs fail and the page loads again
  reload: () => void;
}

// the Mac's fill worker gives a job as long before it replaces the worker
const JOB_TIMEOUT_MS = 30_000;

const READER_GONE = "the reader page went away before it answered";

interface Job {
  id: number;
  job: FillJob;
  resolve: (answer: FillAnswer) => void;
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

export const createFillPageHost = (args: FillPageHostArgs): FillPageHost => {
  const jobTimeoutMs = args.jobTimeoutMs ?? JOB_TIMEOUT_MS;
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
    deliver({ id: entry.id, job: entry.job, nonce, type: "fillJob" });
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
    failAll(READER_GONE);
  };

  const reload = (): void => {
    forget();
    view?.reload();
  };

  return {
    attach: (next) => {
      if (next === null) {
        forget();
      }
      view = next;
    },

    read: async (job) =>
      // oxlint-disable-next-line promise/avoid-new -- the page answers as a frame, which only a promise can hand to an await
      await new Promise<FillAnswer>((resolve, reject) => {
        const id = nextId;
        nextId += 1;
        const entry: Job = {
          cancelTimer: setTimer(jobTimeoutMs, () => {
            jobs.delete(id);
            reject(new Error(`the reader did not answer within ${String(jobTimeoutMs)}ms`));
            reload();
          }),
          id,
          job,
          reject,
          resolve,
          sent: false,
        };
        jobs.set(id, entry);
        send(entry);
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
        deliver({ mode: "fill", nonce, type: "init" });
        for (const entry of jobs.values()) {
          send(entry);
        }
        return;
      }
      if (frame.type !== "fillAnswer" || frame.nonce !== nonce) {
        return;
      }
      const entry = jobs.get(frame.id);
      if (entry === undefined) {
        return;
      }
      jobs.delete(frame.id);
      entry.cancelTimer();
      entry.resolve(frame.answer);
    },

    reload,
  };
};
