// The dev-harness fixture bridge must serve the knowledge channels from the
// REAL core engine over its in-memory vault — live queries, not canned data —
// so backlink/graph/search UI is exercisable (and honest) in the harness.
// Knowledge runs the harness's real composition: LinkGraphIndex + the SQL
// store over the wasm driver (the module loads once, up front).
import { describe, expect, it } from "vitest";

import { createSqlKnowledgeStore } from "@repo/notes/knowledge/sql-knowledge-store";

import { createFixtureBridge } from "../../../dev/fixture-bridge";
import { createWasmSqlDriver, loadSqlite3 } from "../../../dev/wasm-sql-driver";

const sqlite3 = await loadSqlite3();

const newBridge = () =>
  createFixtureBridge((root) => createSqlKnowledgeStore(createWasmSqlDriver(sqlite3), root));

describe("fixture bridge knowledge channels", () => {
  it("reflects writes live across search, backlinks, targets, and the graph", async () => {
    const bridge = newBridge();

    // A term that cannot pre-exist in the fixture vault.
    expect(await bridge.searchVault({ query: "xyzzyplugh" })).toEqual([]);

    await bridge.writeVaultDoc({
      path: "review/probe.md",
      content: "# Xyzzyplugh\n\nlinks [[review/other]]\n",
    });
    await bridge.writeVaultDoc({ path: "review/other.md", content: "# Other\n" });

    const hits = await bridge.searchVault({ query: "xyzzyplugh" });
    expect(hits.map((r) => r.path)).toContain("review/probe.md");

    const backlinks = await bridge.getBacklinks({ path: "review/other.md" });
    expect(backlinks.map((b) => b.sourcePath)).toContain("review/probe.md");

    const targets = await bridge.listWikiTargets();
    expect(targets.map((t) => t.path)).toContain("review/probe.md");

    const graph = await bridge.getLinkGraph({});
    expect(graph.nodes.map((n) => n.id)).toContain("review/probe.md");
  });

  it("rename rewrites links, fires knowledge events, and delete drops backlinks", async () => {
    const bridge = newBridge();
    let events = 0;
    bridge.onKnowledgeUpdated(() => {
      events++;
    });

    await bridge.writeVaultDoc({ path: "review/hub.md", content: "see [[probe target]]\n" });
    await bridge.writeVaultDoc({ path: "review/probe target.md", content: "# P\n" });

    const renamed = await bridge.renameVaultEntry({
      from: "review/probe target.md",
      to: "review/probe renamed.md",
    });
    expect(renamed.ok).toBe(true);
    expect(await bridge.readVaultDoc({ path: "review/hub.md" })).toBe("see [[probe renamed]]\n");
    expect(await bridge.getBacklinks({ path: "review/probe renamed.md" })).toHaveLength(1);
    expect(events).toBeGreaterThanOrEqual(3);

    await bridge.deleteVaultEntry({ path: "review/hub.md" });
    expect(await bridge.getBacklinks({ path: "review/probe renamed.md" })).toEqual([]);
  });

  it("lists the seeded attachment as a grouped asset target, after docs", async () => {
    const bridge = newBridge();
    const targets = await bridge.listWikiTargets();
    const asset = targets.find((t) => t.path === "wiki/diagram.png");
    expect(asset).toEqual({ path: "wiki/diagram.png", title: "diagram.png", type: "asset" });
    // Docs first, assets after — the picker renders the groups in this order.
    const firstAssetIndex = targets.findIndex((t) => t.type === "asset");
    expect(targets.slice(0, firstAssetIndex).every((t) => t.type === "doc")).toBe(true);
    expect(targets.slice(firstAssetIndex).every((t) => t.type === "asset")).toBe(true);
  });

  it("renaming an asset rewrites md image and wiki embed references", async () => {
    const bridge = newBridge();
    await bridge.writeVaultDoc({
      path: "review/gallery.md",
      content: "shot ![alt](../wiki/diagram.png), embed ![[diagram.png]]\n",
    });

    const renamed = await bridge.renameVaultEntry({
      from: "wiki/diagram.png",
      to: "assets/schematic.png",
    });
    expect(renamed.ok).toBe(true);
    expect(await bridge.readVaultDoc({ path: "review/gallery.md" })).toBe(
      "shot ![alt](../assets/schematic.png), embed ![[schematic.png]]\n",
    );
    expect(await bridge.getBacklinks({ path: "assets/schematic.png" })).toHaveLength(2);
  });

  it("refuses a clobbering rename like the host", async () => {
    const bridge = newBridge();
    await bridge.writeVaultDoc({ path: "a.md", content: "A\n" });
    await bridge.writeVaultDoc({ path: "b.md", content: "B\n" });
    const result = await bridge.renameVaultEntry({ from: "a.md", to: "b.md" });
    expect(result.ok).toBe(false);
    expect(await bridge.readVaultDoc({ path: "b.md" })).toBe("B\n");
  });
});
