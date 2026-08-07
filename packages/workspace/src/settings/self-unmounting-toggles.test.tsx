// A Settings button that UNMOUNTS ITSELF on click dismisses the whole dialog:
// Base UI's outside-press check resolves after the press, finds the target
// detached from the DOM, and reads it as a click outside the dialog.
//
// The property that prevents it is simply "the button is still mounted after
// its own click", which is deterministic and testable here — unlike the
// dismissal itself, which needs a real dialog + synthesized native press.
// Every toggle below therefore stays mounted and changes label/visibility in
// place rather than living inside a ternary or `&&` guard that swaps it out.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

vi.stubGlobal(
  "matchMedia",
  (media: string): MediaQueryList => ({
    matches: false,
    media,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
);

import type { Bridge } from "@repo/bridge/ipc-registry";
import { createSqlKnowledgeStore } from "@repo/notes/knowledge/sql-knowledge-store";
import { ThemeProvider } from "@repo/ui/lib/theme";
import { createFixtureBridge } from "@repo/workspace/dev/fixture-bridge";
import { createWasmSqlDriver, loadSqlite3 } from "@repo/workspace/dev/wasm-sql-driver";
import { installBridge } from "@repo/bridge/client";
import { RoutinesSection } from "./sections/routines-section";
import { SkillsSection } from "./sections/skills-section";

const sqlite3 = await loadSqlite3();
const newBridge = (): Bridge =>
  createFixtureBridge((root) => createSqlKnowledgeStore(createWasmSqlDriver(sqlite3), root));

function renderSection(node: React.ReactNode) {
  installBridge(newBridge());
  return render(
    <ThemeProvider theme="light" setTheme={() => {}}>
      {node}
    </ThemeProvider>,
  );
}

/** Click `button` and assert the very same DOM node is still connected. A
 * detached target is exactly what trips the outside-press dismissal. */
function expectSurvivesOwnClick(button: HTMLElement): void {
  fireEvent.click(button);
  expect(button.isConnected).toBe(true);
}

describe("routines section", () => {
  it("'Add routine…' hides rather than unmounting when the form opens", async () => {
    renderSection(<RoutinesSection />);
    const add = await screen.findByRole("button", { name: "Add routine…" });

    expectSurvivesOwnClick(add);
    await waitFor(() => expect(add.className).toContain("hidden"));
    expect(add.isConnected).toBe(true);
    // The form it reveals is present.
    expect(screen.getByPlaceholderText("Morning briefing")).toBeTruthy();
  });
});

describe("skills section", () => {
  it("'Add skill…' hides rather than unmounting when the form opens", async () => {
    renderSection(<SkillsSection />);
    const add = await screen.findByRole("button", { name: "Add skill…" });

    expectSurvivesOwnClick(add);
    await waitFor(() => expect(add.className).toContain("hidden"));
    expect(add.isConnected).toBe(true);
    expect(screen.getByPlaceholderText("Weekly review")).toBeTruthy();
  });
});
