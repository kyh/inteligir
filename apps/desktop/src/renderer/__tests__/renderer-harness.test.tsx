import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

// Guards the jsdom renderer test project itself: proves React + jsdom +
// @testing-library render here, so renderer component/hook tests (*.test.tsx)
// have a working home. Keep at least one *.test.tsx in this project — vitest
// errors ("No test files found") when a project matches nothing.
describe("renderer test harness (jsdom)", () => {
  it("renders a React component into jsdom", () => {
    render(<div>hello renderer</div>);
    expect(screen.getByText("hello renderer").textContent).toBe("hello renderer");
  });
});
