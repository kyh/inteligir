import { describe, expect, it } from "vitest";
import {
  initialUpdateState,
  reduceCheckStart,
  reduceDownloadComplete,
  reduceDownloadProgress,
  reduceDownloadStart,
  reduceFailure,
  reduceNoUpdate,
  reduceUpdateAvailable,
  updateAction,
  updateStateSchema,
} from "../../update-state";

const AT = "2026-09-04T10:00:00.000Z";

const idle = initialUpdateState("0.4.0", null);
const available = reduceUpdateAvailable(idle, "0.5.0", AT);
const downloading = reduceDownloadStart(available, "0.5.0");
const downloaded = reduceDownloadComplete(downloading, "0.5.0");

describe("the update state", () => {
  it("starts idle with a feed and disabled with the reason without one", () => {
    expect(idle.status).toBe("idle");
    const disabled = initialUpdateState("0.4.0", "no feed");
    expect(disabled).toMatchObject({ reason: "no feed", status: "disabled" });
    expect(updateAction(disabled)).toBeNull();
  });

  it("a disabled updater stays disabled whatever the updater reports", () => {
    const disabled = initialUpdateState("0.4.0", "no feed");
    for (const next of [
      reduceCheckStart(disabled, AT),
      reduceUpdateAvailable(disabled, "0.5.0", AT),
      reduceNoUpdate(disabled, AT),
      reduceDownloadStart(disabled, "0.5.0"),
      reduceDownloadComplete(disabled, "0.5.0"),
      reduceFailure(disabled, "boom", AT),
    ]) {
      expect(next).toBe(disabled);
    }
  });

  it("a downloaded update survives a later check, whatever it answers", () => {
    const checking = reduceCheckStart(downloaded, AT);
    expect(checking).toMatchObject({
      retry: { action: "install", version: "0.5.0" },
      status: "checking",
    });
    expect(reduceNoUpdate(checking, AT)).toMatchObject({ status: "downloaded", version: "0.5.0" });
    expect(reduceUpdateAvailable(checking, "0.5.0", AT).status).toBe("downloaded");
    // a newer version than the one on disk is a fresh download, not the old one
    expect(reduceUpdateAvailable(checking, "0.6.0", AT)).toMatchObject({
      status: "available",
      version: "0.6.0",
    });
  });

  it("a check that finds nothing forgets a version it had only found, not downloaded", () => {
    expect(reduceNoUpdate(reduceCheckStart(available, AT), AT).status).toBe("up-to-date");
  });

  it("progress is a clamped integer percent, and the same state when nothing moved", () => {
    const moved = reduceDownloadProgress(downloading, 42.9);
    expect(moved).toMatchObject({ percent: 42, status: "downloading" });
    expect(reduceDownloadProgress(moved, 42.2)).toBe(moved);
    expect(reduceDownloadProgress(moved, 140)).toMatchObject({ percent: 100 });
    expect(reduceDownloadProgress(moved, -1)).toMatchObject({ percent: 0 });
    // a progress frame outside a download has no version to belong to
    expect(reduceDownloadProgress(idle, 10)).toBe(idle);
  });

  it("the next action follows what is known: download if a version is, install if bytes are", () => {
    expect(updateAction(idle)).toEqual({ action: "check" });
    expect(updateAction(available)).toEqual({ action: "download", version: "0.5.0" });
    expect(updateAction(downloading)).toBeNull();
    expect(updateAction(downloaded)).toEqual({ action: "install", version: "0.5.0" });
    expect(updateAction(reduceCheckStart(idle, AT))).toBeNull();
  });

  it("a failure offers again the step that failed, with the version it acted on", () => {
    expect(updateAction(reduceFailure(reduceCheckStart(idle, AT), "boom", AT))).toEqual({
      action: "check",
    });
    // a check that fails after one had found a version still offers that download
    expect(updateAction(reduceFailure(reduceCheckStart(available, AT), "boom", AT))).toEqual({
      action: "download",
      version: "0.5.0",
    });
    expect(updateAction(reduceFailure(downloading, "boom"))).toEqual({
      action: "download",
      version: "0.5.0",
    });
    expect(updateAction(reduceFailure(downloaded, "boom"))).toEqual({
      action: "install",
      version: "0.5.0",
    });
  });

  it("every reduced state is one the page can parse", () => {
    for (const state of [
      idle,
      initialUpdateState("0.4.0", "no feed"),
      reduceCheckStart(idle, AT),
      reduceCheckStart(downloaded, AT),
      available,
      downloading,
      reduceDownloadProgress(downloading, 10),
      downloaded,
      reduceNoUpdate(reduceCheckStart(idle, AT), AT),
      reduceFailure(reduceCheckStart(idle, AT), "boom", AT),
      reduceFailure(downloading, "boom"),
      reduceFailure(downloaded, "boom"),
    ]) {
      expect(updateStateSchema.safeParse(state).success).toBe(true);
    }
  });

  it("the page refuses a frame that mixes two statuses' fields", () => {
    expect(
      updateStateSchema.safeParse({ ...available, percent: 10, status: "available" }).success,
    ).toBe(false);
    expect(updateStateSchema.safeParse({ ...idle, status: "downloaded" }).success).toBe(false);
  });
});
