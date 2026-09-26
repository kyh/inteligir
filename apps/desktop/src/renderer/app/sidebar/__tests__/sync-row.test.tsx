// @vitest-environment jsdom

import { setTimeout as delay } from "node:timers/promises";
import type { CloudStatusResponse } from "@repo/api/local/cloud/cloud-schema";
import type { VaultStatusResponse } from "@repo/api/local/vault/vault-schema";
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

const NO_REMOTE: VaultStatusResponse = {
  conflicts: [],
  device: "This Mac",
  externalSync: null,
  lastError: null,
  lastSyncAt: null,
  state: "no-remote",
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
    queryClient.setQueryData(orpc.vault.status.queryKey(), NO_REMOTE);
    render(
      <QueryClientProvider client={queryClient}>
        <SyncRow onSyncNow={() => {}} onOpenSyncDetails={() => {}} />
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
    queryClient.setQueryData(orpc.vault.status.queryKey(), NO_REMOTE);
    render(
      <QueryClientProvider client={queryClient}>
        <SyncRow onSyncNow={() => {}} onOpenSyncDetails={() => {}} />
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

// what a failed pass leaves in `lastError`: git's own words
const GIT_STDERR =
  "fatal: unable to access 'https://example.com/vault.git/': Could not resolve host";

const REMOTE_FIELDS = {
  conflicts: [],
  device: "This Mac",
  externalSync: null,
  lastError: GIT_STDERR,
  lastSyncAt: null,
  remote: "https://example.com/vault.git",
  remoteSource: "explicit",
} satisfies Omit<Extract<VaultStatusResponse, { state: "offline" }>, "state">;

const openRow = async (vault: VaultStatusResponse, onOpenSyncDetails = () => {}) => {
  stubRpc({ "threads/list": () => ({ nextCursor: null, threads: [] }) });
  const queryClient = createWorkspaceQueryClient();
  queryClient.setQueryData(orpc.cloud.status.queryKey(), SIGNED_IN);
  queryClient.setQueryData(orpc.vault.status.queryKey(), vault);
  render(
    <QueryClientProvider client={queryClient}>
      <SyncRow onSyncNow={() => {}} onOpenSyncDetails={onOpenSyncDetails} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByLabelText("Sync and account"));
  await screen.findByText("Sync now");
};

describe("the rail's sync row", () => {
  it("says a failed pass in its own words, never the engine's", async () => {
    await openRow({ state: "offline", ...REMOTE_FIELDS });

    expect(document.body.textContent).not.toContain(GIT_STDERR);
    expect(document.body.textContent).not.toMatch(/\b(?:git|remote|fatal)\b/iu);
    expect(screen.getByText("Offline")).toBeDefined();
  });

  it("offers no second sync for actions, which sync on their own", async () => {
    await openRow({ state: "clean", ...REMOTE_FIELDS, lastError: null });

    expect(screen.getByText("Sign out")).toBeDefined();
    expect(screen.queryByText("Sync threads now")).toBeNull();
    expect(screen.queryByText("Sync details…")).toBeNull();
  });

  it("opens the details in Settings when sync cannot continue on its own", async () => {
    const opened = vi.fn<() => void>();
    await openRow({ state: "broken", ...REMOTE_FIELDS }, opened);

    fireEvent.click(screen.getByText("Sync details…"));
    expect(opened).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toContain(GIT_STDERR);
  });
});
