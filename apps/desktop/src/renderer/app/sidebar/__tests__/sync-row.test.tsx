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
import { stubRpc } from "./rpc-stub";

const SIGNED_OUT: CloudStatusResponse = { cloudUrl: "https://cloud.test", state: "signed-out" };

const SIGNED_IN: CloudStatusResponse = {
  accountEmail: "me@cloud.test",
  cloudUrl: "https://cloud.test",
  connected: true,
  cursor: 0,
  deviceId: "dev_1",
  lastError: null,
  lastSyncedAt: null,
  pending: 0,
  state: "signed-in",
};

const NO_REMOTE: VaultStatusResponse = { lastError: null, lastSyncAt: null, state: "no-remote" };

// a dialog opens through a portal a frame after its state flips, so an absent one is only
// absent after a wait
const DIALOG_PAINT_MS = 50;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the rail's sign-in", () => {
  it("closes once the sign-in lands, so a later sign-out does not open it again", async () => {
    stubRpc({ "cloud/login": () => SIGNED_IN });
    const queryClient = createWorkspaceQueryClient();
    queryClient.setQueryData(orpc.cloud.status.queryKey(), SIGNED_OUT);
    queryClient.setQueryData(orpc.vault.status.queryKey(), NO_REMOTE);
    queryClient.setQueryData(orpc.threads.list.queryKey(), { threads: [] });
    render(
      <QueryClientProvider client={queryClient}>
        <SyncRow onSyncNow={() => {}} />
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
});
