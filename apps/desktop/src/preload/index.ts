import { contextBridge, ipcRenderer } from "electron";

import { IPC_CHANNELS } from "@/shared/ipc";

function forwardEvent(
  channel: string,
  listener: (data: unknown) => void,
): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, data: unknown) => {
    listener(data);
  };
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

contextBridge.exposeInMainWorld("desktopBridge", {
  // Desktop
  openExternal: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_EXTERNAL, url),
  checkForUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_CHECK),
  downloadUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_DOWNLOAD),
  installUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_INSTALL),
  onUpdateState: (listener: (state: unknown) => void) =>
    forwardEvent(IPC_CHANNELS.UPDATE_STATE, listener),

  // App lifecycle
  getAppState: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_STATE),
  transition: (event: unknown) => ipcRenderer.invoke(IPC_CHANNELS.APP_TRANSITION, event),
  onAppState: (listener: (state: unknown) => void) =>
    forwardEvent(IPC_CHANNELS.APP_STATE, listener),

  // Agent
  onAgentEvent: (listener: (event: unknown) => void) =>
    forwardEvent(IPC_CHANNELS.AGENT_EVENT, listener),
  sendAgentCommand: (command: unknown) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_COMMAND, command),
  getAgentHistory: () => ipcRenderer.invoke(IPC_CHANNELS.AGENT_HISTORY),

  // Tasks
  createTask: (params: unknown) => ipcRenderer.invoke(IPC_CHANNELS.TASK_CREATE, params),
  listTasks: () => ipcRenderer.invoke(IPC_CHANNELS.TASK_LIST),
  deleteTask: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.TASK_DELETE, id),
  toggleTask: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.TASK_TOGGLE, id),

  // Voice (LiveKit)
  getVoiceToken: () => ipcRenderer.invoke(IPC_CHANNELS.VOICE_TOKEN),
  stopVoice: () => ipcRenderer.invoke(IPC_CHANNELS.VOICE_STOP),
});
