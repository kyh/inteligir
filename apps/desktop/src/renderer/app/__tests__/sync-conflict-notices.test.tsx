// @vitest-environment jsdom

import { setTimeout as delay } from "node:timers/promises";
import type { VaultStatusResponse, VaultSyncConflict } from "@repo/api/local/vault/vault-schema";
import { Toaster, toast } from "@repo/ui/components/sonner";
import { ThemeProvider } from "@repo/ui/lib/theme";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { orpc } from "../api";
import { useSyncConflictNotices } from "../sync-conflict-notices";
import { createWorkspaceQueryClient } from "../workspace-context";

afterEach(() => {
  cleanup();
  // sonner replays every undismissed toast to the next Toaster that mounts.
  toast.dismiss();
  window.localStorage.clear();
});

const COPIED: VaultSyncConflict = {
  at: 2000,
  copyDevice: "Studio",
  copyPath: "Plans (conflict, Studio).md",
  keptDevice: "This Mac",
  kind: "copied",
  path: "Plans.md",
};
const COPIED_SENTENCE =
  "Both versions of “Plans” were kept: yours stays, and the one from Studio is in “Plans (conflict, Studio)”.";

const KEPT_EDIT: VaultSyncConflict = {
  at: 3000,
  deletedDevice: "Studio",
  keptDevice: "This Mac",
  kind: "kept-edit",
  path: "Ideas.md",
};
const KEPT_EDIT_SENTENCE = "“Ideas” was deleted on Studio but edited here, so it was kept.";

// newest first, as the server lists them
const statusWith = (
  conflicts: readonly VaultSyncConflict[],
  lastSyncAt = 1000,
): VaultStatusResponse => ({
  conflicts: [...conflicts],
  device: "This Mac",
  externalSync: null,
  lastError: null,
  lastSyncAt,
  remote: "https://cloud.test/v1/git/vault.git",
  remoteSource: "account",
  state: "clean",
});

// a toast lands a macrotask after it is raised
const TOAST_PAINT_MS = 50;

const Notices = ({ onOpen }: { onOpen: (path: string) => void }) => {
  useSyncConflictNotices(onOpen);
  return null;
};

const mount = (status: VaultStatusResponse, onOpen: (path: string) => void = () => {}) => {
  const queryClient = createWorkspaceQueryClient();
  queryClient.setQueryData(orpc.vault.status.queryKey(), status);
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme="light" setTheme={() => {}}>
        <Toaster />
        <Notices onOpen={onOpen} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return queryClient;
};

const openFromToast = (sentence: string): void => {
  const notice = screen.getByText(sentence).closest("[data-sonner-toast]");
  const button = notice?.querySelector("[data-action]");
  if (!(button instanceof HTMLElement)) {
    throw new Error(`no Open on the toast saying ${sentence}`);
  }
  fireEvent.click(button);
};

describe("a sync conflict's notice", () => {
  it("says a report the status already held once, and a refetch says nothing again", async () => {
    const queryClient = mount(statusWith([COPIED]));
    expect(await screen.findByText(COPIED_SENTENCE)).toBeDefined();

    act(() => {
      queryClient.setQueryData(orpc.vault.status.queryKey(), statusWith([COPIED], 5000));
    });
    await delay(TOAST_PAINT_MS);

    expect(screen.getAllByText(COPIED_SENTENCE)).toHaveLength(1);
  });

  it("opens the copy for a copied note, and the note itself for a kept edit", async () => {
    const onOpen = vi.fn<(path: string) => void>();
    mount(statusWith([KEPT_EDIT, COPIED]), onOpen);

    await screen.findByText(COPIED_SENTENCE);
    openFromToast(COPIED_SENTENCE);
    openFromToast(KEPT_EDIT_SENTENCE);

    expect(onOpen.mock.calls).toEqual([["Plans (conflict, Studio).md"], ["Ideas.md"]]);
  });

  it("says only what arrived after the last one it said, across a remount", async () => {
    mount(statusWith([COPIED]));
    expect(await screen.findByText(COPIED_SENTENCE)).toBeDefined();
    cleanup();
    toast.dismiss();

    mount(statusWith([KEPT_EDIT, COPIED]));
    expect(await screen.findByText(KEPT_EDIT_SENTENCE)).toBeDefined();
    expect(screen.queryByText(COPIED_SENTENCE)).toBeNull();
  });

  it("says a report that arrives while the window is open", async () => {
    const queryClient = mount(statusWith([]));
    await delay(TOAST_PAINT_MS);
    expect(screen.queryByText(KEPT_EDIT_SENTENCE)).toBeNull();

    act(() => {
      queryClient.setQueryData(orpc.vault.status.queryKey(), statusWith([KEPT_EDIT]));
    });

    expect(await screen.findByText(KEPT_EDIT_SENTENCE)).toBeDefined();
  });
});
