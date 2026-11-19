import { describe, expect, it } from "vitest";

import type { ExportAsk, ExportNews } from "./export-news";
import {
  createExportStore,
  EXPORT_BROKE,
  exportAfter,
  exportFileName,
  exportUnloadAsks,
} from "./export-run";
import type { ExportRun, ExportTarget, ExportThread, ThreadEars } from "./export-run";

const COUNTS = { filesMissing: 0, items: 2, propertiesLeftOut: 0 };
const TARGET: ExportTarget = {
  ask: { kind: "download" },
  name: "Inteligir library 2026-11-19.zip",
};

// a thread the suite speaks for, the target the person chose, and what reached the download
const fakeHost = (target: ExportTarget | null = TARGET) => {
  const sent: ExportAsk[] = [];
  const delivered: { zip: Blob; name: string }[] = [];
  let ears: ThreadEars | null = null;
  let closed = 0;
  const store = createExportStore({
    choose: async () => await Promise.resolve(target),
    deliver: (zip, name) => {
      delivered.push({ name, zip });
    },
    spawn: (heard): ExportThread => {
      ears = heard;
      return {
        close: () => {
          closed += 1;
        },
        send: (ask) => {
          sent.push(ask);
        },
      };
    },
  });
  const tell = (news: ExportNews): void => {
    ears?.heard(news);
  };
  return { closed: () => closed, delivered, sent, store, tell };
};

describe(exportAfter, () => {
  it("starts only from rest, and moves only while it runs", () => {
    const listing = exportAfter({ kind: "idle" }, { kind: "start" });
    expect(listing).toStrictEqual({ kind: "listing" });
    expect(exportAfter(listing, { kind: "start" })).toBe(listing);
    const done = exportAfter(listing, {
      kind: "heard",
      news: { counts: COUNTS, kind: "done", zip: null },
    });
    expect(done).toStrictEqual({ counts: COUNTS, kind: "done" });
    expect(exportAfter(done, { kind: "stop" })).toBe(done);
    expect(exportAfter(done, { kind: "broke" })).toBe(done);
  });

  it("says how far it got when it stops, and fails when its thread breaks", () => {
    const writing = exportAfter(
      { kind: "listing" },
      { kind: "heard", news: { kind: "writing", total: 9, written: 4 } },
    );
    expect(exportAfter(writing, { kind: "stop" })).toStrictEqual({ kind: "stopped", written: 4 });
    expect(exportAfter(writing, { kind: "broke" })).toStrictEqual({
      kind: "failed",
      message: EXPORT_BROKE,
    });
  });
});

describe(createExportStore, () => {
  it("hands the thread where the zip goes, downloads a zip it hands back, and closes it at the end", async () => {
    const host = fakeHost();
    await host.store.start(() => {});
    expect(host.sent).toStrictEqual([TARGET.ask]);
    host.tell({ kind: "writing", total: 2, written: 1 });
    expect(host.closed()).toBe(0);
    const zip = new Blob(["zip"]);
    host.tell({ counts: COUNTS, kind: "done", zip });
    expect(host.delivered).toStrictEqual([{ name: TARGET.name, zip }]);
    expect(host.store.get()).toStrictEqual({ counts: COUNTS, kind: "done" });
    expect(host.closed()).toBe(1);
  });

  it("starts nothing when the person closes the picker", async () => {
    const host = fakeHost(null);
    await host.store.start(() => {});
    expect(host.sent).toStrictEqual([]);
    expect(host.store.get()).toStrictEqual({ kind: "idle" });
  });

  it("closes the thread on Stop, downloads nothing after, and starts no second while one runs", async () => {
    const host = fakeHost();
    await host.store.start(() => {});
    await host.store.start(() => {});
    expect(host.sent).toHaveLength(1);
    host.store.stop();
    expect(host.store.get()).toStrictEqual({ kind: "stopped", written: 0 });
    expect(host.closed()).toBe(1);
    host.tell({ counts: COUNTS, kind: "done", zip: new Blob(["zip"]) });
    expect(host.delivered).toStrictEqual([]);
  });

  it("hands a session's end to the tab, and goes on", async () => {
    const host = fakeHost();
    const ends: string[] = [];
    await host.store.start((end) => {
      ends.push(end);
    });
    host.tell({ end: "signed-out", kind: "session-ended" });
    expect(ends).toStrictEqual(["signed-out"]);
    expect(host.store.get()).toStrictEqual({ kind: "listing" });
  });
});

describe(exportUnloadAsks, () => {
  const runs: readonly ExportRun[] = [
    { kind: "idle" },
    { kind: "listing" },
    { kind: "writing", total: 3, written: 1 },
    { counts: COUNTS, kind: "done" },
    { kind: "stopped", written: 1 },
    { kind: "failed", message: EXPORT_BROKE },
  ];

  it("asks as the tab closes only while the run lists or writes", () => {
    expect(
      runs.filter((run) => exportUnloadAsks(run, { kind: "live" })).map((run) => run.kind),
    ).toStrictEqual(["listing", "writing"]);
  });

  it("never asks once the session ended, on its way to the sign-in", () => {
    for (const run of runs) {
      expect(exportUnloadAsks(run, { kind: "ended", why: "signed-out" })).toBe(false);
      expect(exportUnloadAsks(run, { kind: "left" })).toBe(false);
    }
  });
});

describe(exportFileName, () => {
  it("names the zip by the day on this device", () => {
    expect(exportFileName(new Date(2026, 0, 5, 23, 59))).toBe("Inteligir library 2026-01-05.zip");
  });
});
