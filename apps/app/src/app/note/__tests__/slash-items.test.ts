// @vitest-environment jsdom

import type { AgentWriteMode } from "@repo/domain/agent-write-mode";
import type { SlashBlock, SlashItem } from "@repo/editor/slash-menu";
import { parsedNodeNames } from "@repo/editor/test-support/block-nodes";
import { describe, expect, test, vi } from "vitest";
import type { DelegationIntent } from "../../chat/chat-model";
import { noteSlashItems } from "../slash-items";

/**
 * What each row CLAIMS to insert, as a node in the editor's own grammar. The
 * table is the review surface: a row this file does not name fails below, so
 * a construct cannot join the menu without someone saying which decoration
 * makes it visible.
 */
const CONSTRUCTS: Record<string, string> = {
  "heading-1": "ATXHeading1",
  "heading-2": "ATXHeading2",
  "heading-3": "ATXHeading3",
  "bullet-list": "BulletList",
  "numbered-list": "OrderedList",
  "task-list": "Task",
  quote: "Blockquote",
  callout: "Callout",
  divider: "HorizontalRule",
  "code-block": "FencedCode",
  table: "Table",
  "math-block": "Math",
  image: "Image",
};

const HANDOFFS = ["agent-ask", "agent-write"];

const itemsFor = (
  writeMode: AgentWriteMode,
  onDelegate: (
    intent: DelegationIntent,
    mode: AgentWriteMode,
    block: SlashBlock,
  ) => void = () => {},
): SlashItem[] => noteSlashItems({ writeMode: () => writeMode, onDelegate });

/** The context the trigger guarantees: a block-empty line after a blank one. */
const documentWith = (text: string): string => `Intro.\n\n${text}\n`;

describe("the note's slash vocabulary", () => {
  test("every row is either a named construct or a named handoff", () => {
    expect(
      itemsFor("direct")
        .map((item) => item.id)
        .toSorted(),
    ).toEqual([...Object.keys(CONSTRUCTS), ...HANDOFFS].toSorted());
  });

  test.each(Object.entries(CONSTRUCTS))("%s re-parses to a %s the editor decorates", (id, node) => {
    const item = itemsFor("direct").find((row) => row.id === id);
    expect(item?.action.kind).toBe("insert");
    if (item?.action.kind !== "insert") return;
    expect(parsedNodeNames(documentWith(item.action.text))).toContain(node);
  });

  test("every caret offset lands inside the text it names", () => {
    for (const item of itemsFor("direct")) {
      if (item.action.kind !== "insert") continue;
      expect(item.action.caret).toBeGreaterThanOrEqual(0);
      expect(item.action.caret ?? 0).toBeLessThanOrEqual(item.action.text.length);
    }
  });

  test("the agent rows hand off to the one delegation seam", () => {
    const onDelegate = vi.fn();
    const block: SlashBlock = { from: 8, to: 8, text: "" };
    for (const item of itemsFor("direct", onDelegate)) {
      if (item.action.kind === "handoff") item.action.run(block);
    }
    expect(onDelegate.mock.calls).toEqual([
      ["ask", "direct", block],
      ["do", "direct", block],
    ]);
  });

  test("under review mode the write row says so, and delegates so", () => {
    const onDelegate = vi.fn();
    const items = itemsFor("propose", onDelegate);
    const write = items.find((item) => item.id === "agent-write");
    expect(write?.label).toBe("Have the agent suggest…");
    if (write?.action.kind === "handoff") write.action.run({ from: 0, to: 0, text: "" });
    expect(onDelegate).toHaveBeenCalledWith("do", "propose", { from: 0, to: 0, text: "" });

    // `ask` writes nothing, so it names no mode whatever the setting says.
    const ask = items.find((item) => item.id === "agent-ask");
    expect(ask?.label).toBe("Ask the agent…");
    if (ask?.action.kind === "handoff") ask.action.run({ from: 0, to: 0, text: "" });
    expect(onDelegate).toHaveBeenCalledWith("ask", "direct", { from: 0, to: 0, text: "" });
  });
});
