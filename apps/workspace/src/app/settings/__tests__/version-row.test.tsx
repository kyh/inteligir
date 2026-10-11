// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { VersionRow } from "../version-row";

afterEach(cleanup);

describe("the version row", () => {
  it("links the changelog beside the version, opened outside the app's window", () => {
    render(<VersionRow version="0.5.0" />);
    expect(screen.getByText("0.5.0")).toBeDefined();
    const link = screen.getByRole("link", { name: "What's new" });
    expect(link.getAttribute("href")).toBe(
      "https://github.com/kyh/inteligir/blob/main/CHANGELOG.md",
    );
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("keeps the link while the version is still loading", () => {
    render(<VersionRow version={undefined} />);
    expect(screen.getByText("…")).toBeDefined();
    expect(screen.getByRole("link", { name: "What's new" })).toBeDefined();
  });
});
