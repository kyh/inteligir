// Main forks the server, so the debug choice, a restart, the server's log and the data folder are
// main's; the page mirrors its answer. A browser tab did not start the server: no bridge, no row.

import type { DesktopDiagnosticsBridge } from "../../types";
import type { DiagnosticsAnswer, DiagnosticsState } from "../../diagnostics-state";
import { createBridgeStore } from "./bridge-store";
import { runPathAction } from "./desktop-paths";

const diagnosticsBridge = (): DesktopDiagnosticsBridge | undefined =>
  window.desktopBridge?.diagnostics;

const adoptInitial = async (
  diagnostics: DesktopDiagnosticsBridge,
  adopt: (state: DiagnosticsState) => void,
): Promise<void> => {
  let state;
  try {
    state = await diagnostics.getState();
  } catch (error) {
    console.warn("[diagnostics] the shell did not answer", error);
    return;
  }
  adopt(state);
};

const store = createBridgeStore<DesktopDiagnosticsBridge, DiagnosticsState>({
  bridge: diagnosticsBridge,
  start: (diagnostics, adopt) => {
    void adoptInitial(diagnostics, adopt);
  },
});

export const useDesktopDiagnostics = store.use;

// main's refusal, in main's words, or null once the answer is adopted
const settleAnswer = async (
  ask: (diagnostics: DesktopDiagnosticsBridge) => Promise<DiagnosticsAnswer>,
): Promise<string | null> => {
  const diagnostics = diagnosticsBridge();
  if (diagnostics === undefined) {
    return null;
  }
  const answer = await ask(diagnostics);
  if (!answer.ok) {
    return answer.reason;
  }
  store.adopt(answer.state);
  return null;
};

export const setDebugLogging = async (debug: boolean): Promise<string | null> =>
  await settleAnswer(async (diagnostics) => await diagnostics.setDebug(debug));

// the window closes once main quits, so an answer that lands is a refusal or the last state
export const restartApp = async (): Promise<string | null> =>
  await settleAnswer(async (diagnostics) => await diagnostics.restart());

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
