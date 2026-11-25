import { assert, describe, test } from "vitest";

import { apply, percentOf, wire } from "./update-session";
import type { Phase, Step, UpdateEvent } from "./update-session";

const AVAILABLE: Phase = { kind: "available", version: "1.2.3" };
const DOWNLOADING: Phase = { kind: "downloading", percent: 7, retrying: null, version: "1.2.3" };
const DOWNLOADED: Phase = { kind: "downloaded", version: "1.2.3" };
const DOWNLOAD_FAILED: Phase = { kind: "download-failed", message: "offline", version: "1.2.3" };
const INSTALL_FAILED: Phase = { kind: "install-failed", message: "disk full", version: "1.2.3" };
const INSTALLING: Phase = { kind: "installing", version: "1.2.3" };

const run = (phase: Phase, ...events: UpdateEvent[]) => {
  let at: Step = { phase, work: null };

  for (const event of events) {
    at = apply(at.phase, event);
  }

  return at;
};

describe("the update session", () => {
  test("floors a share and holds it in range", () => {
    assert.strictEqual(percentOf(0), 0);
    assert.strictEqual(percentOf(33.9), 33);
    assert.strictEqual(percentOf(100), 100);
    assert.strictEqual(percentOf(250), 100);
    assert.strictEqual(percentOf(Number.NaN), 0);
  });

  test("downloads and installs a found update on a click each", () => {
    const checking = apply({ kind: "idle" }, { kind: "check-asked" });
    assert.deepEqual(checking, { phase: { kind: "checking" }, work: "check" });
    const found = apply(checking.phase, { found: "1.2.3", kind: "checked" });
    assert.deepEqual(found.phase, AVAILABLE);
    const asked = apply(found.phase, { kind: "download-asked" });
    assert.strictEqual(asked.work, "download");
    assert.deepEqual(wire(asked.phase), { status: "available", version: "1.2.3" });
    const receiving = apply(asked.phase, { kind: "progress", percent: 42 });
    assert.deepEqual(wire(receiving.phase), { downloadPercent: 42, status: "downloading" });
    const downloaded = apply(receiving.phase, { kind: "download-ended", message: null });
    assert.deepEqual(downloaded.phase, DOWNLOADED);
    const installing = apply(downloaded.phase, { kind: "install-asked" });
    assert.strictEqual(installing.work, "install");
    assert.deepEqual(wire(installing.phase), { status: "downloaded", version: "1.2.3" });
  });

  test("does nothing for a restart asked again while installing", () => {
    const again = apply(INSTALLING, { kind: "install-asked" });
    assert.deepEqual(again, { phase: INSTALLING, work: null });
    const failed = apply(again.phase, { kind: "install-failed", message: "disk full" });
    assert.deepEqual(failed.phase, INSTALL_FAILED);
    assert.deepEqual(wire(failed.phase), {
      message: "disk full",
      status: "install-failed",
      version: "1.2.3",
    });
  });

  test("downloads a failed download again with no check", () => {
    const failed = apply(DOWNLOADING, { kind: "download-ended", message: "offline" });
    assert.deepEqual(failed.phase, DOWNLOAD_FAILED);
    const retry = apply(failed.phase, { kind: "download-asked" });
    assert.deepEqual(retry, {
      phase: { kind: "downloading", percent: null, retrying: "offline", version: "1.2.3" },
      work: "download",
    });
    assert.deepEqual(
      apply(retry.phase, { kind: "download-ended", message: null }).phase,
      DOWNLOADED,
    );
  });

  test("reads a retry as its failure until bytes arrive", () => {
    const retrying = apply(DOWNLOAD_FAILED, { kind: "download-asked" });
    assert.deepEqual(wire(retrying.phase), wire(DOWNLOAD_FAILED));
    const failed = apply(retrying.phase, { kind: "download-ended", message: "still offline" });
    assert.deepEqual(wire(failed.phase), {
      message: "still offline",
      status: "download-failed",
      version: "1.2.3",
    });

    const receiving = run(
      failed.phase,
      { kind: "download-asked" },
      { kind: "progress", percent: 0 },
    );

    assert.deepEqual(wire(receiving.phase), { downloadPercent: 0, status: "downloading" });
  });

  test("installs again after a failed install", () => {
    assert.deepEqual(apply(INSTALL_FAILED, { kind: "install-asked" }), {
      phase: INSTALLING,
      work: "install",
    });
  });

  test("installs or downloads nothing before its turn", () => {
    for (const phase of [
      { kind: "idle" },
      { kind: "checking" },
      AVAILABLE,
      { kind: "not-available" },
      DOWNLOAD_FAILED,
    ] satisfies Phase[]) {
      assert.deepEqual(apply(phase, { kind: "install-asked" }), { phase, work: null });
    }

    for (const phase of [
      { kind: "idle" },
      { kind: "checking" },
      DOWNLOADED,
      { kind: "not-available" },
      INSTALL_FAILED,
    ] satisfies Phase[]) {
      assert.deepEqual(apply(phase, { kind: "download-asked" }), { phase, work: null });
    }
  });

  test("lets a found release go when checked again", () => {
    const outcome = run(
      AVAILABLE,
      { kind: "check-asked" },
      { kind: "download-asked" },
      { kind: "check-ended-badly", message: "offline" },
      { kind: "download-asked" },
    );

    assert.deepEqual(outcome, { phase: { kind: "check-failed", message: "offline" }, work: null });
  });

  test("tells a failed check from a failed download, and checks again from either", () => {
    const unread = apply({ kind: "checking" }, { kind: "check-ended-badly", message: "offline" });
    assert.deepEqual(wire(unread.phase), { message: "offline", status: "check-failed" });
    const cut = apply(DOWNLOADING, { kind: "download-ended", message: "cut off" });
    assert.deepEqual(wire(cut.phase), {
      message: "cut off",
      status: "download-failed",
      version: "1.2.3",
    });

    for (const failed of [unread.phase, cut.phase]) {
      assert.deepEqual(apply(failed, { kind: "check-asked" }), {
        phase: { kind: "checking" },
        work: "check",
      });
    }
  });

  test("waits on a check under way and on an update in hand", () => {
    for (const phase of [
      { kind: "checking" },
      DOWNLOADING,
      DOWNLOADED,
      INSTALLING,
      INSTALL_FAILED,
    ] satisfies Phase[]) {
      assert.deepEqual(apply(phase, { kind: "check-asked" }), { phase, work: null });
    }
  });

  test("moves only the phase an answer belongs to", () => {
    assert.deepEqual(apply(AVAILABLE, { kind: "progress", percent: 50 }).phase, AVAILABLE);
    assert.deepEqual(apply({ kind: "idle" }, { found: null, kind: "checked" }).phase, {
      kind: "idle",
    });
    assert.deepEqual(
      apply(DOWNLOADED, { kind: "download-ended", message: "late" }).phase,
      DOWNLOADED,
    );
    assert.deepEqual(
      apply(DOWNLOAD_FAILED, { kind: "install-failed", message: "late" }).phase,
      DOWNLOAD_FAILED,
    );
  });
});
