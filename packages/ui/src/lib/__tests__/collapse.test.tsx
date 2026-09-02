// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Collapse } from "../collapse";

afterEach(cleanup);

describe("Collapse", () => {
  it("makes a closed fold inert, so the controls it clips leave the tab order with the accessibility tree", () => {
    const { rerender } = render(
      <Collapse open={false}>
        <button type="button">inside</button>
      </Collapse>,
    );
    const fold = screen.getByText("inside").parentElement?.parentElement;
    expect(fold).not.toBeNull();
    expect(fold?.hasAttribute("inert")).toBe(true);
    expect(fold?.hasAttribute("aria-hidden")).toBe(false);

    rerender(
      <Collapse open>
        <button type="button">inside</button>
      </Collapse>,
    );
    expect(fold?.hasAttribute("inert")).toBe(false);
  });
});
