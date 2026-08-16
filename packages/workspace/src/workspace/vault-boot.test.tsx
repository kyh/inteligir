// What a cold open COSTS, and what a save costs after it (jsdom).
//
// Both are latency the user feels and neither is visible from a type: the boot
// is one round trip only if nothing follows it, and a save is cheap only if the
// broadcast it causes does not send every client back for a listing it already
// has. So the provider runs over the real fixture Bridge with every vault call
// counted, and the count is the assertion.

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

// No vitest globals in this repo, so testing-library can't auto-cleanup. The
// open-note store outlives a render (it is the workspace's own module state),
// so it is reset too or one case reads the previous one's note.
afterEach(() => {
  cleanup();
  publishOpenPath(null);
  publishEditor({ root: "", path: null, content: "", dirty: false, saving: false });
});

import { installBridge } from "@repo/bridge/client";
import type { Bridge } from "@repo/bridge/ipc-contract";
import { UI_STATE_OPEN_NOTE_KEY } from "@repo/bridge/ui-state";
import { publishEditor, publishOpenPath, useOpenNote } from "@repo/editor/note/open-note-store";
import { createSqlKnowledgeStore } from "@repo/notes/knowledge/sql-knowledge-store";
import { createFixtureBridge } from "@repo/workspace/dev/fixture-bridge";
import { createWasmSqlDriver, loadSqlite3 } from "@repo/workspace/dev/wasm-sql-driver";
import { VaultProvider } from "@repo/workspace/workspace/vault-context";

const sqlite3 = await loadSqlite3();

/** A fixture Bridge that records every vault call the provider makes. */
function countedBridge(): { bridge: Bridge; calls: string[] } {
  const base = createFixtureBridge((root) =>
    createSqlKnowledgeStore(createWasmSqlDriver(sqlite3), root),
  );
  const calls: string[] = [];
  const bridge: Bridge = {
    ...base,
    getWorkspaceBoot: () => {
      calls.push("getWorkspaceBoot");
      return base.getWorkspaceBoot();
    },
    listVault: () => {
      calls.push("listVault");
      return base.listVault();
    },
    readVaultFile: (params) => {
      calls.push("readVaultFile");
      return base.readVaultFile(params);
    },
  };
  return { bridge, calls };
}

/** Reads the open note out of the store the provider publishes into. */
function OpenNoteProbe() {
  const path = useOpenNote((s) => s.editor.path);
  const content = useOpenNote((s) => s.editor.content);
  return <div data-testid="open-note">{`${path ?? "none"}|${content.length}`}</div>;
}

async function mountOver(bridge: Bridge) {
  installBridge(bridge);
  const view = render(
    <VaultProvider>
      <OpenNoteProbe />
    </VaultProvider>,
  );
  const probe = await view.findByTestId("open-note");
  return { view, probe };
}

const OPEN_NOTE = "notes/roadmap.md";

describe("a cold open", () => {
  it("costs ONE round trip — listing, ui state and the open note's bytes", async () => {
    const { bridge, calls } = countedBridge();
    await bridge.setUiState({ key: UI_STATE_OPEN_NOTE_KEY, value: OPEN_NOTE });
    const { probe } = await mountOver(bridge);

    // The note is open with its text, and nothing was fetched to get it there.
    await waitFor(() => {
      expect(probe.textContent).toMatch(new RegExp(`^${OPEN_NOTE}\\|[1-9]`));
    });
    expect(calls).toEqual(["getWorkspaceBoot"]);
  });

  it("opens nothing when ui state names nothing", async () => {
    const { bridge, calls } = countedBridge();
    const { probe } = await mountOver(bridge);

    await waitFor(() => {
      expect(calls).toEqual(["getWorkspaceBoot"]);
    });
    expect(probe.textContent).toBe("none|0");
  });
});

describe("the broadcast a save causes", () => {
  it("does NOT send a client back for a listing the change cannot have moved", async () => {
    const { bridge, calls } = countedBridge();
    await mountOver(bridge);
    await waitFor(() => {
      expect(calls).toEqual(["getWorkspaceBoot"]);
    });

    // A content-only write of a file already in the listing — every sidebar row
    // is identical afterwards, which is what an autosave looks like.
    const [existing] = await bridge.listVault();
    calls.length = 0;
    await bridge.writeVaultFile({ path: existing?.path ?? "", content: "changed\n" });

    await waitFor(() => {
      expect(bridge.listVault).toBeTruthy();
    });
    expect(calls, "a content-only change re-listed the vault").toEqual([]);
  });

  it("DOES re-list when a path arrives or leaves", async () => {
    const { bridge, calls } = countedBridge();
    await mountOver(bridge);
    await waitFor(() => {
      expect(calls).toEqual(["getWorkspaceBoot"]);
    });

    calls.length = 0;
    await bridge.writeVaultFile({ path: "brand/new-note.md", content: "# New\n" });
    await waitFor(() => {
      expect(calls).toEqual(["listVault"]);
    });

    calls.length = 0;
    await bridge.deleteVaultEntry({ path: "brand/new-note.md" });
    await waitFor(() => {
      expect(calls).toEqual(["listVault"]);
    });
  });

  it("re-lists on a refresh, which describes no change at all", async () => {
    const { bridge, calls } = countedBridge();
    await mountOver(bridge);
    await waitFor(() => {
      expect(calls).toEqual(["getWorkspaceBoot"]);
    });

    calls.length = 0;
    await bridge.refreshVault();
    await waitFor(() => {
      expect(calls).toEqual(["listVault"]);
    });
  });
});
