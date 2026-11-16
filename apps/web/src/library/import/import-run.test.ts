import { describe, expect, it } from "vitest";

import type { ImportAsk, ImportNews } from "./import-news";
import { createImportStore, IMPORT_BROKE, importAfter } from "./import-run";
import type { ImportThread, ThreadEars } from "./import-run";

const NONE = { added: 0, alreadySaved: 0, unreadable: 0 };
const ASK: ImportAsk = { file: new Blob(["url\n"]), source: "raindrop" };

// a thread the suite speaks for, and whether the store closed it
const fakeThread = () => {
  const sent: ImportAsk[] = [];
  let ears: ThreadEars | null = null;
  let closed = 0;
  const spawn = (heard: ThreadEars): ImportThread => {
    ears = heard;
    return {
      close: () => {
        closed += 1;
      },
      send: (ask) => {
        sent.push(ask);
      },
    };
  };
  const tell = (news: ImportNews): void => {
    ears?.heard(news);
  };
  return { closed: () => closed, sent, spawn, tell };
};

describe(importAfter, () => {
  it("starts only from rest, and moves only while it runs", () => {
    const reading = importAfter({ kind: "idle" }, { kind: "start", source: "markdown" });
    expect(reading).toStrictEqual({ kind: "reading", source: "markdown" });
    expect(importAfter(reading, { kind: "start", source: "raindrop" })).toBe(reading);
    const done = importAfter(reading, { kind: "heard", news: { counts: NONE, kind: "done" } });
    expect(done).toStrictEqual({ counts: NONE, kind: "done" });
    expect(importAfter(done, { kind: "stop" })).toBe(done);
    expect(importAfter(done, { kind: "broke" })).toBe(done);
  });

  it("keeps what it added when it stops or its thread breaks", () => {
    const landing = importAfter(
      { kind: "reading", source: "raindrop" },
      { kind: "heard", news: { counts: { ...NONE, added: 4 }, kind: "landing", total: 9 } },
    );
    expect(importAfter(landing, { kind: "stop" })).toStrictEqual({
      counts: { ...NONE, added: 4 },
      kind: "stopped",
    });
    expect(importAfter(landing, { kind: "broke" })).toStrictEqual({
      counts: { ...NONE, added: 4 },
      kind: "failed",
      message: IMPORT_BROKE,
    });
  });
});

describe(createImportStore, () => {
  it("hands the thread its file, and closes it at the run's end", () => {
    const thread = fakeThread();
    const store = createImportStore(thread.spawn);
    store.start(ASK, () => {});
    expect(thread.sent).toStrictEqual([ASK]);
    thread.tell({ counts: NONE, kind: "landing", total: 1 });
    expect(thread.closed()).toBe(0);
    thread.tell({ counts: { ...NONE, added: 1 }, kind: "done" });
    expect(store.get()).toStrictEqual({ counts: { ...NONE, added: 1 }, kind: "done" });
    expect(thread.closed()).toBe(1);
  });

  it("closes the thread on Stop, and starts no second while one runs", () => {
    const thread = fakeThread();
    const store = createImportStore(thread.spawn);
    store.start(ASK, () => {});
    store.start({ ...ASK, source: "markdown" }, () => {});
    expect(thread.sent).toHaveLength(1);
    store.stop();
    expect(store.get()).toStrictEqual({ counts: NONE, kind: "stopped" });
    expect(thread.closed()).toBe(1);
  });

  it("hands a session's end to the tab, and goes on", () => {
    const thread = fakeThread();
    const store = createImportStore(thread.spawn);
    const ends: string[] = [];
    store.start(ASK, (end) => {
      ends.push(end);
    });
    thread.tell({ end: "signed-out", kind: "session-ended" });
    expect(ends).toStrictEqual(["signed-out"]);
    expect(store.get()).toStrictEqual({ kind: "reading", source: "raindrop" });
  });
});
