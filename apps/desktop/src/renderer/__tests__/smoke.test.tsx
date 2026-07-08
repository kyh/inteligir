import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

// Temporary: proves the jsdom renderer project renders React. Deleted once real
// renderer component tests land.
describe("jsdom renderer project", () => {
  it("renders a component", () => {
    render(<div>hello renderer</div>);
    expect(screen.getByText("hello renderer").textContent).toBe("hello renderer");
  });
});
