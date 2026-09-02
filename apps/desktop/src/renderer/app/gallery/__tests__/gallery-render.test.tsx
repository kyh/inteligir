// @vitest-environment jsdom

import { ThemeProvider } from "@repo/ui/lib/theme";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { GalleryPage } from "../gallery-page";

afterEach(cleanup);

function mount() {
  return render(
    <ThemeProvider theme="dark" setTheme={() => undefined}>
      <GalleryPage onBack={() => undefined} />
    </ThemeProvider>,
  );
}

describe("gallery renders", () => {
  it("mounts every section without throwing", () => {
    mount();

    for (const title of [
      "Actions",
      "Inputs",
      "Overlays",
      "Feedback",
      "Navigation",
      "Agent surfaces",
      "Data",
      "Editing",
      "Tokens",
    ]) {
      expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    }
  });

  it("names every component it demos", () => {
    mount();

    expect(screen.getByText("Button")).toBeDefined();
    expect(screen.getByText(/^InputMessage$/)).toBeDefined();
    expect(screen.getByText(/ApprovalCard/)).toBeDefined();
    expect(screen.getByText(/RecordsTable/)).toBeDefined();
  });
});
