// A job's life as the alarm runs it: taken by a lease that counts the run and puts the row off
// before anything runs, so a run that fails waits longer each time and never runs again at once;
// ended only while nothing asked for it again; and never a row no run could take.

import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

import { cellIn, cellOf, clockAt, inCell, landedValue } from "../test-support/library-cell";
import { runJobs, runKind } from "./cell-alarm";
import { reserve } from "./cell-blobs";
import { finishJob, leaseJobs, scheduleJob } from "./cell-jobs";
import type { LibraryEngine } from "./library-engine";

const jobRows = (state: DurableObjectState) =>
  state.storage.sql.exec("SELECT id, attempts, next_at FROM jobs ORDER BY id").toArray();

const UPLOAD = { id: "upload:x", kind: "upload", payload: { sha: "x" } } as const;

// the one upload job due, leased as the alarm leases it
const leased = (library: LibraryEngine) => {
  const [lease] = landedValue(library.rows((db, now) => leaseJobs(db, now, "upload")));
  if (lease === undefined) {
    throw new Error("no upload job was due");
  }
  return lease;
};

describe("a job the alarm runs", () => {
  it("is taken by a lease, so a run that fails waits longer each time", async () => {
    await inCell(cellOf(), async (state) => {
      const clock = clockAt();
      const cell = cellIn(state, { clock });
      const sha = "5".repeat(64);
      // room nobody used is a stray an hour on
      landedValue(reserve(cell.library, { bytes: 10, mime: "image/png", sha }));
      clock.now += 60 * 60_000;
      await runKind(cell, "upload");
      const r2 = vi.spyOn(env.BLOBS, "delete").mockRejectedValue(new Error("R2 is down"));
      await runKind(cell, "stray");
      expect(jobRows(state)).toStrictEqual([
        { attempts: 1, id: `stray:${sha}`, next_at: clock.now + 30_000 },
      ]);
      // leased, so a run before its time takes nothing
      await expect(runKind(cell, "stray")).resolves.toStrictEqual([]);
      clock.now += 30_000;
      await runKind(cell, "stray");
      expect(jobRows(state)).toStrictEqual([
        { attempts: 2, id: `stray:${sha}`, next_at: clock.now + 60_000 },
      ]);
      r2.mockRestore();
      clock.now += 60_000;
      await runKind(cell, "stray");
      expect(jobRows(state)).toStrictEqual([]);
    });
  });

  it("is ended only while nothing asked for it again since its lease", async () => {
    await inCell(cellOf(), (state) => {
      const { library } = cellIn(state, { clock: clockAt() });
      const ask = (): void => {
        landedValue(
          library.rows((db, now) => {
            scheduleJob(db, UPLOAD, now);
          }),
        );
      };
      const finish = (lease: ReturnType<typeof leased>): void => {
        landedValue(
          library.rows((db) => {
            finishJob(db, lease);
          }),
        );
      };
      ask();
      const first = leased(library);
      expect(first).toMatchObject({ attempts: 1, payload: { sha: "x" } });
      // asked for again while its run goes on: that ask waits for a run of its own
      ask();
      finish(first);
      expect(jobRows(state)).toMatchObject([{ attempts: 0, id: UPLOAD.id }]);
      finish(leased(library));
      expect(jobRows(state)).toStrictEqual([]);
    });
  });

  it("is dropped when its kind no longer reads its payload, so no run fails on it again", async () => {
    await inCell(cellOf(), async (state) => {
      const clock = clockAt();
      const cell = cellIn(state, { clock });
      for (const [id, kind] of [
        ["seal:unread", "seal"],
        ["stray:unread", "stray"],
      ] as const) {
        state.storage.sql.exec(
          "INSERT INTO jobs (id, kind, payload, attempts, next_at) VALUES (?, ?, '{}', 0, ?)",
          id,
          kind,
          clock.now,
        );
      }
      await runJobs(cell);
      expect(jobRows(state)).toStrictEqual([]);
    });
  });

  it("is of a kind the alarm runs, or its row is refused", async () => {
    await inCell(cellOf(), (state) => {
      expect(() =>
        state.storage.sql.exec(
          "INSERT INTO jobs (id, kind, payload, attempts, next_at) VALUES ('import:1', 'import', '{}', 0, 0)",
        ),
      ).toThrow("jobs_kind");
    });
  });
});
