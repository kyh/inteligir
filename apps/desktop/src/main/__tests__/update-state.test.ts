import { describe, expect, it } from "vitest";
import {
  initialUpdateState,
  reduceCheckFailure,
  reduceCheckStart,
  reduceDownloadComplete,
  reduceDownloadFailure,
  reduceDownloadProgress,
  reduceNoUpdate,
  reduceUpdateAvailable,
  updateAction,
  updateStateSchema,
} from "../../update-state";

const AT = "2026-09-04T10:00:00.000Z";

describe("the update state", () => {
  it("starts idle with a feed and disabled with the reason without one", () => {
    expect(initialUpdateState("0.4.0", null).status).toBe("idle");
    const disabled = initialUpdateState("0.4.0", "no feed");
    expect(disabled.status).toBe("disabled");
    expect(disabled.message).toBe("no feed");
    expect(updateAction(disabled)).toBeNull();
  });

  it("a downloaded update survives a later check, whatever it answers", () => {
    const downloaded = reduceDownloadComplete(
      reduceUpdateAvailable(initialUpdateState("0.4.0", null), "0.5.0", AT),
      "0.5.0",
    );
    const checking = reduceCheckStart(downloaded, AT);
    expect(checking.downloadedVersion).toBe("0.5.0");
    expect(checking.downloadPercent).toBe(100);
    expect(reduceNoUpdate(checking, AT).status).toBe("downloaded");
    expect(reduceUpdateAvailable(checking, "0.5.0", AT).status).toBe("downloaded");
    // a newer version than the one on disk is a fresh download, not the old one
    const newer = reduceUpdateAvailable(checking, "0.6.0", AT);
    expect(newer.status).toBe("available");
    expect(newer.downloadedVersion).toBeNull();
  });

  it("progress is a clamped integer percent", () => {
    const downloading = reduceDownloadProgress(initialUpdateState("0.4.0", null), 42.9);
    expect(downloading.downloadPercent).toBe(42);
    expect(reduceDownloadProgress(downloading, 140).downloadPercent).toBe(100);
    expect(reduceDownloadProgress(downloading, -1).downloadPercent).toBe(0);
  });

  it("the next action follows what is known: download if a version is, install if bytes are", () => {
    const idle = initialUpdateState("0.4.0", null);
    expect(updateAction(idle)).toBe("check");
    const available = reduceUpdateAvailable(idle, "0.5.0", AT);
    expect(updateAction(available)).toBe("download");
    expect(updateAction(reduceDownloadFailure(available, "boom"))).toBe("download");
    const downloaded = reduceDownloadComplete(available, "0.5.0");
    expect(updateAction(downloaded)).toBe("install");
    expect(updateAction(reduceCheckFailure(idle, "boom", AT))).toBe("check");
    expect(updateAction(reduceCheckStart(idle, AT))).toBeNull();
  });

  it("every reduced state is one the page can parse", () => {
    const idle = initialUpdateState("0.4.0", null);
    for (const state of [
      idle,
      reduceCheckStart(idle, AT),
      reduceUpdateAvailable(idle, "0.5.0", AT),
      reduceDownloadProgress(idle, 10),
      reduceDownloadComplete(idle, "0.5.0"),
      reduceCheckFailure(idle, "boom", AT),
    ]) {
      expect(updateStateSchema.safeParse(state).success).toBe(true);
    }
  });
});
