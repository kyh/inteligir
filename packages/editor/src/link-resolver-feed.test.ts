import type { LinkTarget } from "@repo/editor/host-io";
import { createLinkResolverFeed } from "@repo/editor/link-resolver-feed";
import { describe, expect, it } from "vitest";

const PLAN_ID = "3f1c2b1e-8a4d-4c1e-9b2a-1d2e3f4a5b6c";
const INBOX_ID = "0190a000-0000-7000-8000-000000000001";

const TARGETS: readonly LinkTarget[] = [
  { id: PLAN_ID, title: "Plan" },
  { id: INBOX_ID, title: "Inbox" },
];

describe("the link resolver feed", () => {
  it("resolves nothing before the host feeds it", () => {
    const { store } = createLinkResolverFeed();

    expect(store.getState().resolveWikiTarget("Plan")).toBeNull();
    expect(store.getState().targets).toStrictEqual([]);
  });

  it("answers the item a link names by its title, whatever the case, and by the id it carries", () => {
    const { setTargets, store } = createLinkResolverFeed();

    setTargets(TARGETS);

    expect(store.getState().resolveWikiTarget("Plan")).toBe(PLAN_ID);
    expect(store.getState().resolveWikiTarget("inbox")).toBe(INBOX_ID);
    expect(store.getState().resolveWikiTarget("Old title", PLAN_ID)).toBe(PLAN_ID);
    expect(store.getState().resolveWikiTarget("Nothing yet")).toBeNull();
  });

  it("reaches a title holding a slash as it is written, and two items of one title at the first", () => {
    const { setTargets, store } = createLinkResolverFeed();
    const second = "0190a000-0000-7000-8000-000000000002";

    setTargets([{ id: PLAN_ID, title: "Q3/Q4 plan" }, ...TARGETS, { id: second, title: "Inbox" }]);

    expect(store.getState().resolveWikiTarget("Q3/Q4 plan")).toBe(PLAN_ID);
    expect(store.getState().resolveWikiTarget("Q3 Q4 plan")).toBeNull();
    expect(store.getState().resolveWikiTarget("Inbox")).toBe(INBOX_ID);
    expect(store.getState().resolveWikiTarget("", second)).toBe(second);
  });

  it("reaches no untitled item by an empty name", () => {
    const { setTargets, store } = createLinkResolverFeed();

    setTargets([{ id: PLAN_ID, title: "" }]);

    expect(store.getState().resolveWikiTarget("")).toBeNull();
  });

  it("names an item by id as its card does", () => {
    const { setTargets, store } = createLinkResolverFeed();

    setTargets([{ id: PLAN_ID, title: "Quarterly plan" }]);

    expect(store.getState().titleOf(PLAN_ID)).toBe("Quarterly plan");
    expect(store.getState().titleOf(INBOX_ID)).toBeNull();
  });

  it("hands every subscriber a new resolver each time the host feeds it, so a link re-renders", () => {
    const { setTargets, store } = createLinkResolverFeed();
    const seen: unknown[] = [];
    store.subscribe((next) => {
      seen.push(next);
    });

    setTargets(TARGETS);
    setTargets([...TARGETS, { id: "0190a000-0000-7000-8000-000000000003", title: "Notes" }]);

    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
    expect(store.getState().resolveWikiTarget("Notes")).toBe(
      "0190a000-0000-7000-8000-000000000003",
    );
  });
});
