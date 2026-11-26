import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";

import { APP_ORIGIN_ARG, channelOf } from "../shared/bridge";
import type { Command, UpdateState } from "../shared/bridge";

const siteOrigin = process.argv
  .find((argument) => argument.startsWith(APP_ORIGIN_ARG))
  ?.slice(APP_ORIGIN_ARG.length);

const ask = async (command: Command) => {
  const answer: unknown = await ipcRenderer.invoke(channelOf(command));

  return answer;
};

if (siteOrigin !== undefined && globalThis.location.origin === siteOrigin) {
  contextBridge.exposeInMainWorld("desktopBridge", {
    checkForUpdates: async () => await ask("check-for-updates"),
    downloadUpdate: async () => await ask("download-update"),
    installUpdate: async () => await ask("install-update"),
    onUpdateState: (listener: (state: UpdateState) => void) => {
      const channel = channelOf("update-state");

      const forward = (_event: IpcRendererEvent, state: UpdateState) => {
        listener(state);
      };

      ipcRenderer.on(channel, forward);

      return () => {
        ipcRenderer.removeListener(channel, forward);
      };
    },
  });
}
