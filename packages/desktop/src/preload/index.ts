import { contextBridge, ipcRenderer } from "electron";

import { IPC, type Bridge } from "@repo/core/ipc-registry";

function forwardEvent<T>(channel: string, listener: (data: T) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, data: T) => {
    listener(data);
  };
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

// Auto-construct the bridge from the registry. Each entry's `kind` decides
// the IPC mechanism; the registry's per-entry typing flows into Bridge
// via the `as Bridge` at the end (the runtime shape exactly matches
// what the derivation produces).
const entries = Object.entries(IPC).map(([method, def]) => {
  switch (def.kind) {
    case "invoke":
      return [method, (payload: unknown) => ipcRenderer.invoke(def.channel, payload)] as const;
    case "invoke-void":
      return [method, () => ipcRenderer.invoke(def.channel)] as const;
    case "send":
      return [method, (payload: unknown) => ipcRenderer.send(def.channel, payload)] as const;
    case "event":
      return [
        method,
        (listener: (event: unknown) => void) => forwardEvent(def.channel, listener),
      ] as const;
  }
});

// oxlint-disable-next-line typescript/consistent-type-assertions -- runtime fold over the registry; shape proven by derivation above
const desktopBridge = Object.fromEntries(entries) as unknown as Bridge;

contextBridge.exposeInMainWorld("desktopBridge", desktopBridge);
