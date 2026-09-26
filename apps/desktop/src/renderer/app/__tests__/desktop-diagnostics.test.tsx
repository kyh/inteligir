// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DiagnosticsState } from "../../../diagnostics-state";
import type { DesktopDiagnosticsBridge } from "../../../types";
import { setDebugLogging } from "../desktop-diagnostics";
import { DiagnosticsRows } from "../settings/advanced-section";
import { inertBridge } from "./inert-bridge";

const PENDING_RESTART: DiagnosticsState = {
  canRestart: true,
  debug: true,
  restartRequired: true,
  server: "owned",
};

const openDataFolder = vi.fn<DesktopDiagnosticsBridge["openDataFolder"]>(async () => ({
  ok: true,
}));
const restart = vi.fn<DesktopDiagnosticsBridge["restart"]>(async () => ({
  ok: true,
  state: PENDING_RESTART,
}));
const setDebug = vi.fn<DesktopDiagnosticsBridge["setDebug"]>(async () => ({
  ok: false,
  reason: "The choice could not be saved: EACCES",
}));

// before the first render: the store reads the bridge once, on its first subscriber
beforeAll(() => {
  const bridge = inertBridge();
  window.desktopBridge = {
    ...bridge,
    diagnostics: {
      ...bridge.diagnostics,
      getState: async () => PENDING_RESTART,
      openDataFolder,
      restart,
      setDebug,
    },
  };
});

afterEach(cleanup);

afterAll(() => {
  delete window.desktopBridge;
});

describe("under the shell", () => {
  it("draws the choice, and the rows only main can answer", async () => {
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

  it("hands back main's refusal in main's words", async () => {
    expect(await setDebugLogging(false)).toBe("The choice could not be saved: EACCES");
    expect(setDebug).toHaveBeenCalledWith(false);
  });
});
