// @vitest-environment jsdom

import type { VaultDeletedEntry } from "@repo/api/local/vault/vault-schema";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InertSocket } from "../../__tests__/inert-socket";
import { createWorkspaceQueryClient, WorkspaceProvider } from "../../workspace-context";
import { DeletedNotes } from "../deleted-notes";
import { stubRpc } from "./rpc-stub";

const GONE: VaultDeletedEntry = {
  deletedAt: "2026-09-01T10:00:00.000Z",
  path: "notes/gone.md",
  sha: "0123456789abcdef0123456789abcdef01234567",
};

// the workspace's own query defaults, minus the retries that would hold a refusal for seconds
const mount = () => {
  const onOpenNote = vi.fn<(path: string) => void>();
  const queryClient = createWorkspaceQueryClient();
  queryClient.setDefaultOptions({
    queries: { ...queryClient.getDefaultOptions().queries, retry: false },
  });
  render(
    <WorkspaceProvider>
      <QueryClientProvider client={queryClient}>
        <DeletedNotes onOpenNote={onOpenNote} />
      </QueryClientProvider>
    </WorkspaceProvider>,
  );
  return onOpenNote;
};

beforeEach(() => {
  vi.stubGlobal("WebSocket", InertSocket);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the Deleted view", () => {
  it("says it is reading until the history answers, then calls an empty one empty", async () => {
    stubRpc({ "vault/deleted": () => ({ entries: [] }) });
    mount();
    expect(screen.getByText("Loading…")).toBeDefined();
    expect(await screen.findByText("Nothing has been deleted.")).toBeDefined();
  });

  it("says a refused read failed, never that nothing was deleted, and Try again reads again", async () => {
    // the client logs every refused call in dev
    vi.spyOn(console, "error").mockImplementation(() => {});
    let refuse = true;
    stubRpc({
      "vault/deleted": () => {
        if (refuse) {
          throw new Error("git log failed");
        }
        return { entries: [GONE] };
      },
    });
    mount();
    expect(await screen.findByText("Could not read the vault's history.")).toBeDefined();
    expect(screen.queryByText("Nothing has been deleted.")).toBeNull();
    refuse = false;
    fireEvent.click(screen.getByText("Try again"));
    expect(await screen.findByTitle(GONE.path)).toBeDefined();
  });

  it("restores a clicked note where it was, only if nothing sits there now, and opens it", async () => {
    const writes: unknown[] = [];
    stubRpc({
      "vault/deleted": () => ({ entries: [GONE] }),
      "vault/revision": () => ({ content: "# Gone\n" }),
      "vault/write": (input) => {
        writes.push(input);
        return { path: GONE.path };
      },
    });
    const onOpenNote = mount();
    fireEvent.click(await screen.findByTitle(GONE.path));
    await waitFor(() => {
      expect(onOpenNote).toHaveBeenCalledWith("notes/gone.md");
    });
    expect(writes).toEqual([{ content: "# Gone\n", ifAbsent: true, path: "notes/gone.md" }]);
  });
});
