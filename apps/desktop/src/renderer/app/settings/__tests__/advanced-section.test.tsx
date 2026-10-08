// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { CloudStatusResponse } from "@repo/contract/local/cloud/cloud-schema";
import type { SystemStatusResponse } from "@repo/contract/local/system/system-schema";
import { afterEach, describe, expect, it } from "vitest";
import { DiagnosticsRows, ThreadSyncRows } from "../advanced-section";

afterEach(cleanup);

const NOW_MS = 1_756_600_000_000;

const SIGNED_IN: Extract<CloudStatusResponse, { state: "signed-in" }> = {
  accountEmail: "k@example.test",
  cloudUrl: "https://cloud.test",
  connected: false,
  cursor: 12,
  deviceId: "dev_1",
  dropped: 0,
  lastError: null,
  lastSyncedAt: null,
  pending: 3,
  state: "signed-in",
};

const renderThreads = (status: CloudStatusResponse) =>
  render(<ThreadSyncRows status={status} nowMs={NOW_MS} pending={false} onSync={() => {}} />);

describe("the thread sync, raw", () => {
  it("says polling when no socket is up, rather than implying a live follow", () => {
    renderThreads(SIGNED_IN);
    expect(screen.getByText("signed-in · polling")).toBeDefined();
    expect(screen.getByText("dev_1")).toBeDefined();
    expect(screen.getByText("3 events")).toBeDefined();
    expect(screen.getByText("12")).toBeDefined();
    expect(screen.getByText("never")).toBeDefined();
  });

  it("dates the last sync from the clock it is handed, never its own", () => {
    renderThreads({ ...SIGNED_IN, lastSyncedAt: NOW_MS - 40_000 });
    expect(screen.getByText("40s ago")).toBeDefined();
  });

  it("counts the events that never reached the cloud", () => {
    renderThreads({ ...SIGNED_IN, dropped: 2 });
    expect(screen.getByText("2 events never reached the cloud")).toBeDefined();
  });

  it("shows the cloud's last error verbatim", () => {
    renderThreads({ ...SIGNED_IN, lastError: "sync-conflict: position 7 replayed" });
    expect(screen.getByText("sync-conflict: position 7 replayed")).toBeDefined();
  });
});

const SYSTEM: SystemStatusResponse = {
  agent: { detail: null, mode: "auto", runtime: "acp" },
  dataDir: "/home/me/.inteligir",
  dataDirScope: "root",
  schemaVersion: 7,
  uptimeMs: 42_000,
  vaultDir: "/home/me/Inteligir",
  version: "0.6.0",
};

describe("in a browser tab, with no bridge", () => {
  it("shows the data folder and the server's facts, and draws no Open or Debug row", () => {
    render(<DiagnosticsRows system={SYSTEM} />);
    expect(screen.getByText("/home/me/.inteligir")).toBeDefined();
    expect(screen.getByText("v7")).toBeDefined();
    expect(screen.getByText("42s")).toBeDefined();
    expect(screen.queryByText("Open data folder")).toBeNull();
    expect(screen.queryByText("Debug logging")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByText("Show log")).toBeNull();
  });
});
