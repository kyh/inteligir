import type { VaultEntry } from "@repo/editor/host-io";
import { createLinkResolverStore } from "@repo/editor/link-resolver-store";
import type { WikiTarget } from "@repo/notes/knowledge/link-graph-index";
import { describe, expect, it } from "vitest";

const LISTING: readonly VaultEntry[] = [
  { kind: "doc", name: "Plan.md", path: "Projects/Plan.md" },
  { kind: "doc", name: "Inbox.md", path: "Inbox.md" },
  { kind: "other", name: "chart.png", path: "assets/chart.png" },
];

const PLAN_ID = "3f1c2b1e-8a4d-4c1e-9b2a-1d2e3f4a5b6c";

const TARGETS: readonly WikiTarget[] = [
  { aliases: ["Roadmap"], id: PLAN_ID, path: "Projects/Plan.md", title: "Plan", type: "doc" },
  { path: "Inbox.md", title: "Inbox", type: "doc" },
];

describe("the link resolver store", () => {
  it("resolves nothing before either input arrives", () => {
    const { store } = createLinkResolverStore();

    expect(store.getState().resolveWikiTarget("Plan")).toBeNull();
    expect(store.getState().resolveMdTarget("Plan.md", "Inbox.md")).toBeNull();
    expect(store.getState().targets).toStrictEqual([]);
  });

  it("resolves a note's stem and an md url from the listing alone", () => {
    const { setListing, store } = createLinkResolverStore();

    setListing(LISTING);

    expect(store.getState().resolveWikiTarget("Plan")).toBe("Projects/Plan.md");
    expect(store.getState().resolveMdTarget("assets/chart.png", "Inbox.md")).toBe(
      "assets/chart.png",
    );
    expect(store.getState().resolveWikiTarget("Roadmap")).toBeNull();
  });

  it("adds the targets' alias and id tiers, and carries the targets it was built over", () => {
    const { setListing, setTargets, store } = createLinkResolverStore();
    setListing(LISTING);

    setTargets(TARGETS);

    expect(store.getState().resolveWikiTarget("Roadmap")).toBe("Projects/Plan.md");
    expect(store.getState().resolveWikiTarget("Old title", PLAN_ID)).toBe("Projects/Plan.md");
    expect(store.getState().targets).toBe(TARGETS);
  });

  it("keeps each input when the other one moves", () => {
    const { setListing, setTargets, store } = createLinkResolverStore();
    setTargets(TARGETS);
    setListing(LISTING);

    expect(store.getState().resolveWikiTarget("Roadmap")).toBe("Projects/Plan.md");

    setListing([...LISTING, { kind: "doc", name: "Notes.md", path: "Notes.md" }]);
    expect(store.getState().targets).toBe(TARGETS);
    expect(store.getState().resolveWikiTarget("Notes")).toBe("Notes.md");
  });

  it("hands every subscriber a new resolver on each input, so a link re-renders on it", () => {
    const { setListing, setTargets, store } = createLinkResolverStore();
    const seen: unknown[] = [];
    store.subscribe((next) => {
      seen.push(next);
    });

    setListing(LISTING);
    setTargets(TARGETS);

    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
  });
});
