// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TaskItem, TaskItemDetails, TaskItemLabel, TaskItemRow } from "../task-rows";

afterEach(cleanup);

function item(withDetails: boolean) {
  return (
    <TaskItem>
      <TaskItemRow status="running" ordinal={1}>
        <TaskItemLabel>Build</TaskItemLabel>
      </TaskItemRow>
      {withDetails ? <TaskItemDetails>lines</TaskItemDetails> : null}
    </TaskItem>
  );
}

describe("TaskItemRow", () => {
  it("stops being a toggle once its details part leaves", () => {
    const { rerender } = render(item(true));
    const row = screen.getByRole("button", { name: /Build/ });
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(row.hasAttribute("disabled")).toBe(false);

    rerender(item(false));
    expect(row.hasAttribute("aria-expanded")).toBe(false);
    expect(row.hasAttribute("disabled")).toBe(true);
  });
});
