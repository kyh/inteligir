// The dev-harness fixture bridge must serve the knowledge channels from the
// REAL core engine over its in-memory vault — live queries, not canned data —
// so backlink/graph/search UI is exercisable (and honest) in the harness.
import { describe, expect, it } from "vitest";

import { createFixtureBridge } from "../../dev/fixture-bridge";

describe("fixture bridge knowledge channels", () => {
  it("reflects writes live across search, backlinks, targets, and the graph", async () => {
    const bridge = createFixtureBridge();

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

    const graph = await bridge.getLinkGraph();
    expect(graph.nodes.map((n) => n.id)).toContain("review/probe.md");
  });

  it("rename rewrites links, fires knowledge events, and delete drops backlinks", async () => {
    const bridge = createFixtureBridge();
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

  it("refuses a clobbering rename like the host", async () => {
    const bridge = createFixtureBridge();
    await bridge.writeVaultDoc({ path: "a.md", content: "A\n" });
    await bridge.writeVaultDoc({ path: "b.md", content: "B\n" });
    const result = await bridge.renameVaultEntry({ from: "a.md", to: "b.md" });
    expect(result.ok).toBe(false);
    expect(await bridge.readVaultDoc({ path: "b.md" })).toBe("B\n");
  });
});
