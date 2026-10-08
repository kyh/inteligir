// @vitest-environment jsdom

import { setTimeout as delay } from "node:timers/promises";
import type { CloudStatusResponse } from "@repo/contract/local/cloud/cloud-schema";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { orpc } from "../../api";
import { createWorkspaceQueryClient } from "../../workspace-context";
import { SyncRow } from "../sidebar";
import { stubRpc } from "../../__tests__/rpc-stub";

const SIGNED_OUT: CloudStatusResponse = {
  cloudUrl: "https://cloud.test",
  revokeError: null,
  state: "signed-out",
};

const SIGNED_IN: CloudStatusResponse = {
  accountEmail: "me@cloud.test",
  cloudUrl: "https://cloud.test",
  connected: true,
  cursor: 0,
  deviceId: "dev_1",
  dropped: 0,
  lastError: null,
  lastSyncedAt: null,
  pending: 0,
  state: "signed-in",
};

// a dialog opens through a portal a frame after its state flips, so an absent one is only
// absent after a wait
const DIALOG_PAINT_MS = 50;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the rail's sign-in", () => {
  it("closes once the sign-in lands, so a later sign-out does not open it again", async () => {
    stubRpc({
      "cloud/login": () => SIGNED_IN,
      "threads/list": () => ({ nextCursor: null, threads: [] }),
    });
    const queryClient = createWorkspaceQueryClient();
    queryClient.setQueryData(orpc.cloud.status.queryKey(), SIGNED_OUT);
    render(
      <QueryClientProvider client={queryClient}>
        <SyncRow onOpenSyncDetails={() => {}} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByLabelText("Sync and account"));
    fireEvent.click(await screen.findByText("Sign in…"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Email"), {
      target: { value: "me@cloud.test" },
    });
    fireEvent.change(within(dialog).getByLabelText("Password"), { target: { value: "secret" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Sign in" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    act(() => {
      queryClient.setQueryData(orpc.cloud.status.queryKey(), SIGNED_OUT);
    });
    await delay(DIALOG_PAINT_MS);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("creates the account from the same dialog, and closes once this device is signed in", async () => {
    const signUp = vi.fn(() => SIGNED_IN);
    stubRpc({
      "cloud/signUp": signUp,
      "threads/list": () => ({ nextCursor: null, threads: [] }),
    });
    const queryClient = createWorkspaceQueryClient();
    queryClient.setQueryData(orpc.cloud.status.queryKey(), SIGNED_OUT);
    render(
      <QueryClientProvider client={queryClient}>
        <SyncRow onOpenSyncDetails={() => {}} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByLabelText("Sync and account"));
    fireEvent.click(await screen.findByText("Sign in…"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Create an account" }));
    for (const [label, value] of [
      ["Name", "Me"],
      ["Email", "me@cloud.test"],
      ["Password", "correct horse battery"],
      ["Invite code", "INVITE-1"],
    ] as const) {
      fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
    }
    fireEvent.click(within(dialog).getByRole("button", { name: "Create account" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(signUp).toHaveBeenCalledTimes(1);
  });
});

// what a failed pass leaves in `lastError`: the sync's own words
const RAW_ERROR = "sync-conflict: position 7 replayed";

const openRow = async (cloud: CloudStatusResponse, onOpenSyncDetails = () => {}) => {
  stubRpc({ "threads/list": () => ({ nextCursor: null, threads: [] }) });
  const queryClient = createWorkspaceQueryClient();
  queryClient.setQueryData(orpc.cloud.status.queryKey(), cloud);
  render(
    <QueryClientProvider client={queryClient}>
      <SyncRow onOpenSyncDetails={onOpenSyncDetails} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByLabelText("Sync and account"));
  await screen.findByText("Sync now");
};

describe("the rail's sync row", () => {
  it("says a failed pass in its own words, never the sync's", async () => {
    await openRow({ ...SIGNED_IN, lastError: RAW_ERROR });

    expect(document.body.textContent).not.toContain(RAW_ERROR);
    expect(screen.getByText("Sync paused")).toBeDefined();
  });

  it("says synced once a pass caught up, and offers its account's sign-out", async () => {
    await openRow({ ...SIGNED_IN, lastSyncedAt: 1 });

    expect(screen.getByText("Synced")).toBeDefined();
    expect(screen.getByText("Sign out")).toBeDefined();
    expect(screen.queryByText("Sync details…")).toBeNull();
  });

  it("opens the details in Settings when sync cannot continue on its own", async () => {
    const opened = vi.fn<() => void>();
    await openRow({ ...SIGNED_IN, lastError: RAW_ERROR }, opened);

    fireEvent.click(screen.getByText("Sync details…"));
    expect(opened).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toContain(RAW_ERROR);
  });

  it("offers no sync while signed out", async () => {
    await openRow(SIGNED_OUT);

    expect(screen.getByText("Only on this Mac")).toBeDefined();
    expect(screen.getByText("Sync now").closest("[data-disabled]")).not.toBeNull();
  });
});
