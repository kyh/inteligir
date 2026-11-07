// @vitest-environment jsdom

import { createFakeCell } from "@repo/library-replica/test-support/fake-cell";
import { openDevice } from "@repo/library-replica/test-support/replica-harness";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakePageLibrary, renderOnLibrary } from "../test-support/fake-page-library";
import { QuickLook } from "./quick-look";

afterEach(cleanup);

describe("a look at a card", () => {
  it("is called Untitled for an item with no title and no words", async () => {
    const { replica } = await openDevice(createFakeCell(), "tab");
    const { id } = await replica.createNote({ blocks: [], folderId: null, tags: [], title: "" });
    const { library } = fakePageLibrary({ answer: () => ({}) });

    renderOnLibrary(
      <QuickLook
        row={replica.row(id)}
        onClose={vi.fn<() => void>()}
        onOpen={vi.fn<() => void>()}
        onStep={vi.fn<() => void>()}
      />,
      library,
    );

    await expect(screen.findByRole("dialog", { name: "Untitled" })).resolves.toBeDefined();
    await replica.close();
  });
});
