// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { CloudStatusResponse } from "@repo/api/local/cloud/cloud-schema";
import type { SystemStatusResponse } from "@repo/api/local/system/system-schema";
import type { VaultStatusResponse } from "@repo/api/local/vault/vault-schema";
import { afterEach, describe, expect, it } from "vitest";
import { DiagnosticsRows, ThreadSyncRows, VaultSyncRows } from "../advanced-section";

afterEach(cleanup);

const NOW_MS = 1_756_600_000_000;

// what a failed pass leaves in `lastError`: git's own stderr, naming its machinery
const GIT_STDERR =
  "fatal: unable to access 'https://example.com/vault.git/': error: failed to push some refs to origin (HEAD detached)";

const REJECTED: VaultStatusResponse = {
  lastError: GIT_STDERR,
  lastSyncAt: null,
  remote: "https://example.com/vault.git",
  remoteSource: "explicit",
  state: "rejected",
};

describe("the vault sync, raw", () => {
  it("shows the engine's last error verbatim, beside the raw state and the remote", () => {
    render(<VaultSyncRows status={REJECTED} nowMs={NOW_MS} />);
    expect(screen.getByText(GIT_STDERR).textContent).toBe(GIT_STDERR);
    expect(screen.getByText("rejected")).toBeDefined();
    expect(screen.getByText("https://example.com/vault.git")).toBeDefined();
    expect(screen.getByText("explicit")).toBeDefined();
  });

  it("names every file a conflict stopped on", () => {
    const conflicted: VaultStatusResponse = {
      conflict: { files: ["a.md", "notes/b.md"], ours: { commits: 1 }, theirs: { commits: 2 } },
      lastError: null,
      lastSyncAt: null,
      remote: "https://example.com/vault.git",
      remoteSource: "explicit",
      state: "conflict",
    };
    render(<VaultSyncRows status={conflicted} nowMs={NOW_MS} />);
    expect(screen.getByText("a.md")).toBeDefined();
    expect(screen.getByText("notes/b.md")).toBeDefined();
    expect(screen.getByText("None")).toBeDefined();
  });
});

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
