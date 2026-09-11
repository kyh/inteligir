// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Button } from "../button";

afterEach(cleanup);

const noop = (): void => {
  // a button needs a handler; this test is about layout
};

// The label is trimmed with text-box, which only a block container honours, so an icon left
// inside that block does not size it and the line box pushes it out — the icon drew above the
// label. Every element child belongs beside the text, not within it.
const labelSpan = (button: HTMLElement): HTMLElement | null =>
  button.querySelector("[class*='text-box']");

describe("a button's children", () => {
  it("keeps an icon child out of the trimmed label span", () => {
    render(
      <Button variant="ghost" size="compact" onClick={noop}>
        <svg data-testid="icon" />
        Notes
      </Button>,
    );
    const button = screen.getByRole("button");
    const label = labelSpan(button);
    expect(label?.textContent).toBe("Notes");
    expect(label?.querySelector("svg")).toBeNull();
    expect(screen.getByTestId("icon").parentElement).not.toBe(label);
  });

  it("lays an icon-only button's icon and its count out in one row", () => {
    render(
      <Button variant="ghost" size="icon-compact" aria-label="Comments" onClick={noop}>
        <svg data-testid="icon" />
        <span>3</span>
      </Button>,
    );
    const row = screen.getByTestId("icon").parentElement;
    expect(row?.className).toContain("inline-flex");
    expect(row?.textContent).toBe("3");
  });

  it("still trims a plain text label", () => {
    render(
      <Button variant="primary" onClick={noop}>
        Save
      </Button>,
    );
    expect(labelSpan(screen.getByRole("button"))?.textContent).toBe("Save");
  });
});
