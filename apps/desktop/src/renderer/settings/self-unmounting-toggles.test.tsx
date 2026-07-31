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
import { createFixtureBridge } from "../../../dev/fixture-bridge";
import { createWasmSqlDriver, loadSqlite3 } from "../../../dev/wasm-sql-driver";
import { installBridge } from "@renderer/lib/bridge";
import { AccountSection } from "./sections/account-section";
import { SkillsSection } from "./extensions/skills-section";
import { RoutinesSection } from "./sections/routines-section";

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

describe("account section toggles stay mounted through their own click", () => {
  it("the sign-in ↔ sign-up toggle swaps its label in place", async () => {
    renderSection(<AccountSection />);
    const toggle = await screen.findByRole("button", { name: "New here? Create account" });

    expectSurvivesOwnClick(toggle);
    await waitFor(() => expect(toggle.textContent).toBe("Have an account? Sign in"));

    // …and back again, on the same node.
    expectSurvivesOwnClick(toggle);
    await waitFor(() => expect(toggle.textContent).toBe("New here? Create account"));
  });

  it("'Forgot password?' hides rather than unmounting", async () => {
    renderSection(<AccountSection />);
    const forgot = await screen.findByRole("button", { name: "Forgot password?" });

    expectSurvivesOwnClick(forgot);
    // Still in the tree, just not shown — the mode switched to reset.
    await waitFor(() => expect(forgot.className).toContain("hidden"));
    expect(forgot.isConnected).toBe(true);
  });

  it("the reset mode's way back reuses the same toggle node", async () => {
    renderSection(<AccountSection />);
    const forgot = await screen.findByRole("button", { name: "Forgot password?" });
    const toggle = await screen.findByRole("button", { name: "New here? Create account" });

    fireEvent.click(forgot);
    await waitFor(() => expect(toggle.textContent).toBe("Back to sign in"));

    expectSurvivesOwnClick(toggle);
    await waitFor(() => expect(toggle.textContent).toBe("New here? Create account"));
  });
});

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
