// The shell starts the server, so the debug choice, a restart, the server's log and the data
// folder are the shell's; the page mirrors its answer. A browser tab did not start the server: no
// bridge, no row.

import type { DiagnosticsState } from "../../diagnostics-state";
import { shellDiagnostics } from "../shell-commands";
import { createBridgeStore } from "./bridge-store";
import { runPathAction } from "./desktop-paths";

const store = createBridgeStore<DiagnosticsState>({
  label: "diagnostics",
  read: shellDiagnostics.getState,
});

export const useDesktopDiagnostics = store.use;

export const setDebugLogging = async (debug: boolean): Promise<string | null> =>
  await store.settle(async () => await shellDiagnostics.setDebug({ debug }));

// the window closes once the shell quits, so an answer that lands is a refusal or the last state
export const restartApp = async (): Promise<string | null> =>
  await store.settle(shellDiagnostics.restart);

// drawn only once the store holds the shell's state, so only under the shell
export const openDataFolder = (): void => {
  runPathAction(shellDiagnostics.openDataFolder, "The data folder did not open.");
};

export const showServerLog = (): void => {
  runPathAction(shellDiagnostics.showLog, "The log did not open.");
};
