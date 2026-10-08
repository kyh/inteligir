// What the page asks the shell rather than its server: the updater and the diagnostics, because no
// server can answer for either. Installed once,
// before the first render, and only under the shell: a browser tab on the same server gets none,
// and every surface that needs it draws nothing. Tests install their own.

import { APP_COMMANDS, UPDATE_STATE_EVENT } from "../../ipc-contract";
import type { DesktopBridge } from "../../types";
import { ask, hear, underShell } from "../shell-commands";

declare global {
  interface Window {
    desktopBridge?: DesktopBridge;
  }
}

const createDesktopBridge = (): DesktopBridge => ({
  diagnostics: {
    getState: async () => await ask(APP_COMMANDS.diagnostics.getState),
    openDataFolder: async () => await ask(APP_COMMANDS.diagnostics.openDataFolder),
    restart: async () => await ask(APP_COMMANDS.diagnostics.restart),
    setDebug: async (debug) => await ask(APP_COMMANDS.diagnostics.setDebug, { debug }),
    showLog: async () => await ask(APP_COMMANDS.diagnostics.showLog),
  },
  updates: {
    check: async () => await ask(APP_COMMANDS.updates.check),
    download: async () => await ask(APP_COMMANDS.updates.download),
    getState: async () => await ask(APP_COMMANDS.updates.getState),
    install: async () => await ask(APP_COMMANDS.updates.install),
    onState: (listener) => hear(UPDATE_STATE_EVENT, listener),
  },
});

export const installDesktopBridge = (): void => {
  if (underShell()) {
    window.desktopBridge = createDesktopBridge();
  }
};
