// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DiagnosticsState } from "../shell/diagnostics-state";
import { APP_COMMANDS } from "../shell/ipc-contract";
import type { BridgeAnswer, DoneAnswer } from "../shell/shell-answer";
import { clearShell, mockShell, reply } from "../shell/test-support/mock-shell";
import { setDebugLogging } from "./desktop-diagnostics";
import { DiagnosticsRows } from "./settings/advanced-section";

const PENDING_RESTART: DiagnosticsState = {
  canRestart: true,
  debug: true,
  restartRequired: true,
  server: "owned",
};

const openDataFolder = vi.fn<() => DoneAnswer>(() => ({ ok: true }));
const restart = vi.fn<() => BridgeAnswer<DiagnosticsState>>(() => ({
  ok: true,
  state: PENDING_RESTART,
}));
const setDebug = vi.fn<(choice: { debug: boolean }) => BridgeAnswer<DiagnosticsState>>(() => ({
  ok: false,
  reason: "The choice could not be saved: EACCES",
}));

// before the first render: the store asks the shell once, on its first subscriber
beforeAll(() => {
  mockShell(
    reply(APP_COMMANDS.diagnostics.getState)(() => PENDING_RESTART),
    reply(APP_COMMANDS.diagnostics.openDataFolder)(openDataFolder),
    reply(APP_COMMANDS.diagnostics.restart)(restart),
    reply(APP_COMMANDS.diagnostics.setDebug)(setDebug),
  );
});

afterEach(cleanup);

afterAll(clearShell);

describe("under the shell", () => {
  it("draws the choice, and the rows only the shell can answer", async () => {
    render(<DiagnosticsRows system={undefined} />);

    const restartButton = await screen.findByText("Restart Inteligir");
    expect(screen.getByRole("switch", { name: "Debug logging" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getByText("Takes effect when the app restarts.")).toBeDefined();
    expect(screen.getByText("Show log")).toBeDefined();

    await act(async () => {
      fireEvent.click(screen.getByText("Open data folder"));
      fireEvent.click(restartButton);
      await Promise.resolve();
    });
    expect(openDataFolder).toHaveBeenCalledOnce();
    expect(restart).toHaveBeenCalledOnce();
  });

  it("hands back the shell's refusal in its words", async () => {
    expect(await setDebugLogging(false)).toBe("The choice could not be saved: EACCES");
    expect(setDebug).toHaveBeenCalledWith({ debug: false });
  });
});
