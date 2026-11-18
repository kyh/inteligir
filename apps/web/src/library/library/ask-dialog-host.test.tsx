import { createFakeCell } from "@repo/contract/test-support/fake-cell.test-utils";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { fakePageLibrary, renderOnLibrary } from "../test-support/fake-page-library.test-utils";
import { askFolder, askName, askTags } from "./ask";
import { AskDialogHost } from "./ask-dialog-host";

const FOLDER = { confirm: "Create", initial: "", label: "Folder name", title: "New folder" };
const LINK = { confirm: "Save", initial: "", label: "The page's address", title: "Save a link" };

const hostOver = (cell = createFakeCell()) => {
  renderOnLibrary(<AskDialogHost />, fakePageLibrary({ cell }).library);
};

interface Asked<Answer> {
  readonly answer: Promise<Answer>;
}

const asked = <Answer,>(ask: () => Promise<Answer>) => {
  let answer: Promise<Answer> | undefined;
  act(() => {
    answer = ask();
  });

  if (answer === undefined) {
    throw new Error("the ask was not made");
  }

  return { answer } satisfies Asked<Answer>;
};

const typed = (label: string, value: string) => {
  fireEvent.change(screen.getByRole("textbox", { name: label }), { target: { value } });
};

describe("a command's ask", () => {
  it("answers the name typed and closes, and a dismissed one answers nothing", async () => {
    hostOver();

    const named = asked(async () => await askName(FOLDER));
    typed("Folder name", " Reading ");
    fireEvent.click(await screen.findByRole("button", { name: "Create" }));

    await expect(named.answer).resolves.toBe("Reading");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    const dismissed = asked(async () => await askName(FOLDER));
    fireEvent.click(await screen.findByRole("button", { name: "Close" }));

    await expect(dismissed.answer).resolves.toBeNull();
  });

  it("holds a name it refuses, saying why", async () => {
    hostOver();

    const named = asked(
      async () =>
        await askName({ ...LINK, refuse: (name) => (name === "no" ? "Not that." : null) }),
    );

    typed(LINK.label, "no");
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert").textContent).toBe("Not that.");
    typed(LINK.label, "yes");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await expect(named.answer).resolves.toBe("yes");
  });

  it("made over another dismisses it and opens with a draft of its own", async () => {
    hostOver();

    const first = asked(async () => await askName(FOLDER));
    typed("Folder name", "Reading");
    const second = asked(async () => await askName(LINK));

    await expect(first.answer).resolves.toBeNull();
    expect(screen.getByRole("textbox", { name: LINK.label })).toHaveProperty("value", "");
    typed(LINK.label, "https://example.com");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await expect(second.answer).resolves.toBe("https://example.com");
  });

  it("offers every folder and none to move to", async () => {
    const cell = createFakeCell();
    const folderId = cell.seed.folder("Reading");
    hostOver(cell);

    const picked = asked(async () => await askFolder({ count: 2 }));
    await screen.findByRole("heading", { name: "Move 2 items to" });
    fireEvent.click(await screen.findByRole("button", { name: "Reading" }));
    await expect(picked.answer).resolves.toStrictEqual({ folderId });

    const none = asked(async () => await askFolder({ count: 1 }));
    fireEvent.click(await screen.findByRole("button", { name: "No folder (Unsorted)" }));
    await expect(none.answer).resolves.toStrictEqual({ folderId: null });
  });

  it("adds a tag as it is spelled, or takes off one every subject carries", async () => {
    hostOver();

    const added = asked(async () => await askTags({ count: 1, held: ["field"] }));
    typed("Tag to add", "#to read");
    fireEvent.click(await screen.findByRole("button", { name: "Add" }));
    await expect(added.answer).resolves.toStrictEqual({ add: ["to-read"], remove: [] });

    const removed = asked(async () => await askTags({ count: 1, held: ["field"] }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove the tag field" }));
    await expect(removed.answer).resolves.toStrictEqual({ add: [], remove: ["field"] });
  });
});
