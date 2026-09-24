import { readFile } from "node:fs/promises";
import path from "node:path";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { bootTestApp } from "inteligir/server/testing";
import type { BootedTestApp } from "inteligir/server/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenNoteStoreProvider } from "@repo/editor/note/open-note-context";
import { createOpenNoteStore } from "@repo/editor/note/open-note-store";
import { toast } from "@repo/ui/components/sonner";

import { HistoryTab } from "../history-tab";
import { createWorkspaceQueryClient, WorkspaceProvider } from "../../workspace-context";
import { routeRendererFetch } from "./booted-fetch";
import { routeRendererSocket } from "./booted-socket";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const mountTab = (docPath: string): void => {
  render(
    <QueryClientProvider client={createWorkspaceQueryClient()}>
      <OpenNoteStoreProvider store={createOpenNoteStore()}>
        <HistoryTab docPath={docPath} />
      </OpenNoteStoreProvider>
    </QueryClientProvider>,
  );
};

describe("the history tab under a refused read", () => {
  it("renders the refusal, never a false empty history", async () => {
    const booted = await bootTestApp();
    routeRendererFetch(booted);

    mountTab("../outside.md");
    await waitFor(() => {
      expect(screen.getByText("The history could not be read.")).toBeTruthy();
    });
    expect(screen.queryByText(/No revisions yet/u)).toBeNull();
  });

  it("keeps the honest empty state for a note with no commits yet", async () => {
    const booted = await bootTestApp();
    routeRendererFetch(booted);
    await booted.client.vault.write({ content: "# Fresh\n", path: "fresh.md" });

    mountTab("fresh.md");
    await waitFor(() => {
      expect(screen.getByText(/No revisions yet/u)).toBeTruthy();
    });
    expect(screen.queryByText("The history could not be read.")).toBeNull();
  });
});

const PLAN = "plan.md";
// saved but in no revision yet, as bytes inside the auto-commit's quiet window are.
const EDITED = "# One\n# Two\n# Three\n";

// two committed revisions under uncommitted bytes; answers the oldest revision's sha.
const seedHistory = async (booted: BootedTestApp): Promise<string> => {
  await booted.client.vault.write({ content: "# One\n", path: PLAN });
  await booted.client.vault.commitNow();
  await booted.client.vault.write({ content: "# One\n# Two\n", path: PLAN });
  await booted.client.vault.commitNow();
  await booted.client.vault.write({ content: EDITED, path: PLAN });
  const { revisions } = await booted.client.vault.history({ path: PLAN });
  expect(revisions).toHaveLength(2);
  return revisions.at(-1)?.sha ?? "";
};

// the open note's bytes are what the diff is drawn against, and the restore's CAS base.
const openRevision = async (sha: string): Promise<void> => {
  const store = createOpenNoteStore();
  store.publishOpenPath(PLAN);
  store.publishEditor({ content: EDITED, dirty: false, path: PLAN, saveError: null });
  render(
    <WorkspaceProvider>
      <OpenNoteStoreProvider store={store}>
        <HistoryTab docPath={PLAN} />
      </OpenNoteStoreProvider>
    </WorkspaceProvider>,
  );
  fireEvent.click(await screen.findByText(sha.slice(0, 7)));
  expect(await screen.findByText("-# Three")).toBeDefined();
};

const onDisk = async (booted: BootedTestApp): Promise<string> =>
  await readFile(path.join(booted.vaultDir, PLAN), "utf-8");

describe("restoring a revision from the history tab", () => {
  it("writes the revision's bytes over a checkpoint of the bytes they replace", async () => {
    const booted = await bootTestApp();
    routeRendererFetch(booted);
    routeRendererSocket(booted);
    const oldest = await seedHistory(booted);
    const restored = vi.spyOn(toast, "success");

    await openRevision(oldest);
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => {
      expect(restored).toHaveBeenCalledWith(`Restored ${PLAN} to ${oldest.slice(0, 7)}.`);
    });

    expect(await onDisk(booted)).toBe("# One\n");
    const { revisions } = await booted.client.vault.history({ path: PLAN });
    expect(revisions).toHaveLength(3);
    const checkpoint = await booted.client.vault.revision({
      path: PLAN,
      sha: revisions[0]?.sha ?? "",
    });
    expect(checkpoint.content).toBe(EDITED);
  });

  it("refuses a restore the note moved under after the diff was drawn, keeping what moved it", async () => {
    const booted = await bootTestApp();
    routeRendererFetch(booted);
    routeRendererSocket(booted);
    const oldest = await seedHistory(booted);
    const refused = vi.spyOn(toast, "error");

    await openRevision(oldest);
    await booted.client.vault.write({ content: "# Concurrent\n", path: PLAN });
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => {
      expect(refused).toHaveBeenCalledWith(
        "The note changed while this restore was in flight. Look again and retry.",
      );
    });

    expect(await onDisk(booted)).toBe("# Concurrent\n");
  });
});
