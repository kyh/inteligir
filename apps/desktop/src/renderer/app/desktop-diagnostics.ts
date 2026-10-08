// The shell starts the server, so the debug choice, a restart, the server's log and the data
// folder are the shell's; the page mirrors its answer. A browser tab did not start the server: no
// bridge, no row.

import { toast } from "@repo/ui/components/sonner";
import type { DesktopDiagnosticsBridge } from "../../types";
import type { DiagnosticsState } from "../../diagnostics-state";
import { createBridgeStore } from "./bridge-store";

const diagnosticsBridge = (): DesktopDiagnosticsBridge | undefined =>
  window.desktopBridge?.diagnostics;

const store = createBridgeStore<DesktopDiagnosticsBridge, DiagnosticsState>({
  bridge: diagnosticsBridge,
  label: "diagnostics",
  read: async (diagnostics) => await diagnostics.getState(),
});

export const useDesktopDiagnostics = store.use;

// a refusal is the shell's, in its words; a broken bridge is one sentence, never a stack
const settlePathAction = async (
  action: () => Promise<{ ok: true } | { ok: false; reason: string }>,
  fallback: string,
): Promise<void> => {
  let result;
  try {
    result = await action();
  } catch {
    toast.error(fallback);
    return;
  }
  if (!result.ok) {
    toast.error(result.reason);
  }
};

const runPathAction = (
  action: () => Promise<{ ok: true } | { ok: false; reason: string }>,
  fallback: string,
): void => {
  void settlePathAction(action, fallback);
};

export const setDebugLogging = async (debug: boolean): Promise<string | null> =>
  await store.settle(async (diagnostics) => await diagnostics.setDebug(debug));

// the window closes once the shell quits, so an answer that lands is a refusal or the last state
export const restartApp = async (): Promise<string | null> =>
  await store.settle(async (diagnostics) => await diagnostics.restart());

export const openDataFolder = (): void => {
  const diagnostics = diagnosticsBridge();
  if (diagnostics !== undefined) {
    runPathAction(diagnostics.openDataFolder, "The data folder did not open.");
  }
};

export const showServerLog = (): void => {
  const diagnostics = diagnosticsBridge();
  if (diagnostics !== undefined) {
    runPathAction(diagnostics.showLog, "The log did not open.");
  }
};
