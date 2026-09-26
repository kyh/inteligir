// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CloudStatusResponse } from "@repo/api/local/cloud/cloud-schema";
import type { SystemStatusResponse } from "@repo/api/local/system/system-schema";
import type {
  VaultSetRemoteRequest,
  VaultStatusResponse,
} from "@repo/api/local/vault/vault-schema";
import { afterEach, describe, expect, it } from "vitest";
import { DiagnosticsRows, ThreadSyncRows, VaultSyncRows } from "../advanced-section";
import { SyncRemoteForm } from "../sync-remote-row";

afterEach(cleanup);

const NOW_MS = 1_756_600_000_000;

// what a failed pass leaves in `lastError`: git's own stderr, naming its machinery
const GIT_STDERR =
  "fatal: unable to access 'https://example.com/vault.git/': error: failed to push some refs to origin (HEAD detached)";

const REJECTED: VaultStatusResponse = {
  conflicts: [],
  device: "Kai's MacBook",
  externalSync: null,
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
    expect(screen.getByText("Kai's MacBook")).toBeDefined();
  });

  it("says each note two devices changed at once, from this device's side", () => {
    const merged: VaultStatusResponse = {
      ...REJECTED,
      conflicts: [
        {
          at: NOW_MS,
          copyDevice: "Kai's iPhone",
          copyPath: "notes/Plan (conflict, Kai's iPhone).md",
          keptDevice: "Kai's MacBook",
          kind: "copied",
          path: "notes/Plan.md",
        },
        {
          at: NOW_MS,
          deletedDevice: "Kai's iPhone",
          keptDevice: "Kai's MacBook",
          kind: "kept-edit",
          path: "Ideas.md",
        },
      ],
      lastError: null,
      state: "clean",
    };
    render(<VaultSyncRows status={merged} nowMs={NOW_MS} />);
    expect(
      screen.getByText(
        "Both versions of “Plan” were kept: yours stays, and the one from Kai's iPhone is in “Plan (conflict, Kai's iPhone)”.",
      ),
    ).toBeDefined();
    expect(
      screen.getByText("“Ideas” was deleted on Kai's iPhone but edited here, so it was kept."),
    ).toBeDefined();
    expect(screen.getByText("None")).toBeDefined();
  });
});

const SIGNED_OUT: VaultStatusResponse = {
  conflicts: [],
  device: "Kai's MacBook",
  externalSync: null,
  lastError: null,
  lastSyncAt: null,
  state: "no-remote",
};

const renderRemote = (status: VaultStatusResponse) => {
  const saved: VaultSetRemoteRequest[] = [];
  render(
    <dl>
      <SyncRemoteForm
        status={status}
        pending={false}
        onSave={(choice) => {
          saved.push(choice);
        }}
      />
    </dl>,
  );
  return saved;
};

const saveButton = (): HTMLButtonElement => {
  const button = screen.getByRole("button", { name: "Save" });
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error("Save is not a button");
  }
  return button;
};

describe("where the vault syncs", () => {
  it("is read-only while INTELIGIR_VAULT_REMOTE pins it, and names the variable", () => {
    renderRemote({ ...REJECTED, remoteSource: "pinned", state: "clean" });
    expect(screen.getByText("https://example.com/vault.git")).toBeDefined();
    expect(screen.getByText(/Pinned by INTELIGIR_VAULT_REMOTE/u)).toBeDefined();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("saves a server of the user's own only once its URL is one git dials", () => {
    const saved = renderRemote(SIGNED_OUT);
    expect(saveButton().disabled).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: "Your own git server" }));
    expect(screen.getByText(/stop seeing this vault's notes/u)).toBeDefined();
    const field = screen.getByRole("textbox", { name: "Git server URL" });
    for (const refused of ["--upload-pack=x", "ext::sh", "/plain/local/path"]) {
      fireEvent.change(field, { target: { value: refused } });
      expect(saveButton().disabled, refused).toBe(true);
    }

    fireEvent.change(field, { target: { value: "git@example.com:me/vault.git" } });
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());
    expect(saved).toEqual([{ kind: "remote", url: "git@example.com:me/vault.git" }]);
  });

  it("offers the account back from a server of the user's own", () => {
    const saved = renderRemote({ ...REJECTED, state: "clean" });
    const field = screen.getByRole("textbox", { name: "Git server URL" });
    expect(field instanceof HTMLInputElement && field.value).toBe("https://example.com/vault.git");
    expect(saveButton().disabled).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: "Your account" }));
    fireEvent.click(saveButton());
    expect(saved).toEqual([{ kind: "account" }]);
  });

  it("says the hosted vault stays off in a folder another service syncs", () => {
    renderRemote({ ...SIGNED_OUT, externalSync: { kind: "dropbox" } });
    expect(
      screen.getByText("Dropbox syncs this folder, so the hosted vault stays off here."),
    ).toBeDefined();
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
