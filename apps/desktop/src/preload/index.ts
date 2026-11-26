import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";

import { APP_ORIGIN_ARG, channelOf } from "../shared/bridge";
import type { BridgeEvent, Command, EventPayloads } from "../shared/bridge";

const siteOrigin = process.argv
  .find((argument) => argument.startsWith(APP_ORIGIN_ARG))
  ?.slice(APP_ORIGIN_ARG.length);

const listen = <E extends BridgeEvent>(event: E, listener: (payload: EventPayloads[E]) => void) => {
  const channel = channelOf(event);

  const forward = (_event: IpcRendererEvent, payload: EventPayloads[E]) => {
    listener(payload);
  };

  ipcRenderer.on(channel, forward);

  return () => {
    ipcRenderer.removeListener(channel, forward);
  };
};

const ask = async (command: Command) => {
  const answer: unknown = await ipcRenderer.invoke(channelOf(command));

  return answer;
};

if (siteOrigin !== undefined && globalThis.location.origin === siteOrigin) {
  contextBridge.exposeInMainWorld("desktopBridge", {
    checkForUpdates: async () => await ask("check-for-updates"),
    downloadUpdate: async () => await ask("download-update"),
    installUpdate: async () => await ask("install-update"),
    onQuickCapture: (listener: (capture: EventPayloads["quick-capture"]) => void) =>
      listen("quick-capture", listener),
    onUpdateState: (listener: (state: EventPayloads["update-state"]) => void) =>
      listen("update-state", listener),
  });
}
