// a send from the library: its view context and its preset through the send, the queue and the
// wires, as the agent's prompt reads them.

import { safe } from "@orpc/client";
import { describe, expect, it } from "vitest";

import { LIBRARY_SELECTION_MAX } from "@repo/domain/view-context";
import type { LibraryViewContext } from "@repo/domain/view-context";

import { bootThreadHarness } from "../test-support/boot-app";
import { createThread } from "./test-support/agent-test-harness";

const LIBRARY: LibraryViewContext = {
  paths: ["Unsorted/a.md"],
  scope: { kind: "unsorted" },
  selected: 1,
  surface: "library",
};

describe("a send from the library", () => {
  it("hands a queued send's preset to its turn, and drops its library view context", async () => {
    const { client, driver } = await bootThreadHarness({ mode: "manual" });
    const threadId = await createThread(client);
    const started = await client.threads.send({ text: "first", threadId });
    if (started.kind !== "started") {
      throw new Error("expected a started turn");
    }
    const queued = await client.threads.send({
      preset: "tidy-library",
      text: "",
      threadId,
      viewContext: LIBRARY,
    });
    expect(queued.kind).toBe("queued");
    driver.completeTurn(threadId, started.turnId, "completed");
    expect(driver.startedTurns[1]).toMatchObject({
      preset: "tidy-library",
      text: "Tidy my library",
    });
    expect(driver.startedTurns[1]?.viewContext).toBeUndefined();
  });

  it("refuses a selection past the cap, a path outside the library and a path named twice", async () => {
    const { client } = await bootThreadHarness({ mode: "manual" });
    const threadId = await createThread(client);
    const tooMany = Array.from(
      { length: LIBRARY_SELECTION_MAX + 1 },
      (_, index) => `Unsorted/${String(index)}.md`,
    );
    const refused: LibraryViewContext[] = [
      { ...LIBRARY, paths: tooMany, selected: tooMany.length },
      { ...LIBRARY, paths: ["../outside.md"] },
      { ...LIBRARY, paths: ["Unsorted/a.md", "Unsorted/a.md"], selected: 2 },
    ];
    for (const viewContext of refused) {
      const [error] = await safe(client.threads.send({ text: "these", threadId, viewContext }));
      expect(error).toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(await client.threads.timeline({ threadId })).toMatchObject({ kind: "full" });
  });
});
