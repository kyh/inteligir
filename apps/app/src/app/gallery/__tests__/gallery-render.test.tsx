// @vitest-environment jsdom

// The gallery MOUNTS. Coverage (gallery-coverage.test.ts) proves every
// component has a demo; this proves the demos actually render — a section that
// forgets a required provider, or a component whose props drifted, fails here
// rather than on the page. That gap is real: the gallery is the one place
// every component renders at once, so it is where a design-system change shows
// itself first.

import { ThemeProvider } from "@repo/ui/lib/theme";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { GalleryPage } from "../gallery-page";

afterEach(cleanup);

/** The page's only context dependency. The ROUTE supplies it through
 *  WorkspaceProvider; the test supplies it directly so mounting every
 *  component does not also stand up an api client. */
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

    // One witness per section — the headings the rail's anchors point at.
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

    // A spot-check across the three vendored sets, so a demo that silently
    // stops rendering its own header is caught.
    expect(screen.getByText("Button")).toBeDefined();
    expect(screen.getByText(/^InputMessage$/)).toBeDefined();
    expect(screen.getByText(/ApprovalCard/)).toBeDefined();
    expect(screen.getByText(/RecordsTable/)).toBeDefined();
  });
});
