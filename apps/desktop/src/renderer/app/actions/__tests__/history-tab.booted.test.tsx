import { readFile } from "node:fs/promises";
import path from "node:path";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { VaultRevision } from "@repo/api/local/vault/vault-schema";
import { AGENT_COMMIT_AUTHOR, bootTestApp } from "inteligir/server/testing";
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
    expect(screen.queryByText(/No versions yet/u)).toBeNull();
  });

  it("keeps the honest empty state for a note with no commits yet", async () => {
    const booted = await bootTestApp();
    routeRendererFetch(booted);
    await booted.client.vault.write({
      content: "# Fresh\n",
      guard: { kind: "overwrite" },
      path: "fresh.md",
    });

    mountTab("fresh.md");
    await waitFor(() => {
      expect(screen.getByText(/No versions yet/u)).toBeTruthy();
    });
    expect(screen.queryByText("The history could not be read.")).toBeNull();
  });
});

const PLAN = "plan.md";

// the rows, newest first: a row names its version by when and who, so a test picks one by place
const versionRows = async (count: number): Promise<HTMLElement[]> => {
  await waitFor(() => {
    expect(screen.getAllByRole("button")).toHaveLength(count);
  });
  return screen.getAllByRole("button");
};

const AGENT_SUBJECT = "agent: vault update";
const PERSON = { email: "kai@example.com", name: "Kai Hsu" };
const PERSON_SUBJECT = "Tidy the plan";

describe("a version in the history tab", () => {
  it("is named by who wrote it, never by the engine's subject or its sha", async () => {
    const booted = await bootTestApp();
    routeRendererFetch(booted);
    const write = async (content: string): Promise<void> => {
      await booted.client.vault.write({ content, guard: { kind: "overwrite" }, path: PLAN });
    };
    await write("# One\n");
    await booted.client.vault.commitNow();
    await write("# One\n# Two\n");
    await booted.vault.git.commitPaths([PLAN], AGENT_COMMIT_AUTHOR, AGENT_SUBJECT);
    await write("# One\n# Two\n# Three\n");
    await booted.vault.git.commitPaths([PLAN], PERSON, PERSON_SUBJECT);
    const { revisions } = await booted.client.vault.history({ path: PLAN });

    mountTab(PLAN);
    const rows = await versionRows(3);
    const [person, agent, app] = rows.map((row) => row.textContent);
    expect(person).toContain(PERSON.name);
    expect(person).toContain(PERSON_SUBJECT);
    expect(agent).toContain("Agent");
    expect(app).toContain("You");

    const shown = document.body.textContent ?? "";
    expect(shown).not.toContain(AGENT_SUBJECT);
    for (const revision of revisions) {
      expect(shown).not.toContain(revision.sha.slice(0, 7));
      if (revision.authorKind === "app") {
        expect(shown).not.toContain(revision.subject);
      }
    }
  });
});

// saved but in no revision yet, as bytes inside the auto-commit's quiet window are.
const EDITED = "# One\n# Two\n# Three\n";

// two committed revisions under uncommitted bytes; answers the oldest.
const seedHistory = async (booted: BootedTestApp): Promise<VaultRevision> => {
  await booted.client.vault.write({ content: "# One\n", guard: { kind: "overwrite" }, path: PLAN });
  await booted.client.vault.commitNow();
  await booted.client.vault.write({
    content: "# One\n# Two\n",
    guard: { kind: "overwrite" },
    path: PLAN,
  });
  await booted.client.vault.commitNow();
  await booted.client.vault.write({ content: EDITED, guard: { kind: "overwrite" }, path: PLAN });
  const { revisions } = await booted.client.vault.history({ path: PLAN });
  expect(revisions).toHaveLength(2);
  const oldest = revisions.at(-1);
  if (oldest === undefined) {
    throw new Error("the seeded history has no revision");
  }
  return oldest;
};

// the open note's bytes are what the diff is drawn against, and the restore's CAS base.
const openOldestRevision = async (): Promise<void> => {
  const store = createOpenNoteStore();
  store.publishOpenPath(PLAN);
  store.publishEditor({
    content: EDITED,
    dirty: false,
    diskSeq: 1,
    kind: "open",
    path: PLAN,
    saveError: null,
  });
  render(
    <WorkspaceProvider>
      <OpenNoteStoreProvider store={store}>
        <HistoryTab docPath={PLAN} />
      </OpenNoteStoreProvider>
    </WorkspaceProvider>,
  );
  const rows = await versionRows(2);
  const oldest = rows.at(-1);
  if (oldest === undefined) {
    throw new Error("the history tab drew no row");
  }
  fireEvent.click(oldest);
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
    // another note's unflushed bytes, as a running turn's writes are: the checkpoint is not theirs.
    await booted.client.vault.write({
      content: "# Mid-turn\n",
      guard: { kind: "overwrite" },
      path: "other.md",
    });
    const restored = vi.spyOn(toast, "success");

    await openOldestRevision();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => {
      expect(restored).toHaveBeenCalledTimes(1);
    });
    const [said] = restored.mock.calls[0] ?? [];
    expect(said).toMatch(/^Restored the version from .+\.$/u);
    expect(said).toContain(String(new Date(oldest.authoredAt).getFullYear()));
    expect(said).not.toContain(oldest.sha.slice(0, 7));

    expect(await onDisk(booted)).toBe("# One\n");
    const { revisions } = await booted.client.vault.history({ path: PLAN });
    expect(revisions).toHaveLength(3);
    const checkpoint = await booted.client.vault.revision({
      path: PLAN,
      sha: revisions[0]?.sha ?? "",
    });
    expect(checkpoint.content).toBe(EDITED);
    expect(await booted.client.vault.history({ path: "other.md" })).toEqual({ revisions: [] });
  });

  it("refuses a restore the note moved under after the diff was drawn, keeping what moved it", async () => {
    const booted = await bootTestApp();
    routeRendererFetch(booted);
    routeRendererSocket(booted);
    await seedHistory(booted);
    const refused = vi.spyOn(toast, "error");

    await openOldestRevision();
    await booted.client.vault.write({
      content: "# Concurrent\n",
      guard: { kind: "overwrite" },
      path: PLAN,
    });
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => {
      expect(refused).toHaveBeenCalledWith(
        "The note changed while this restore was in flight. Look again and retry.",
      );
    });

    expect(await onDisk(booted)).toBe("# Concurrent\n");
  });
});
