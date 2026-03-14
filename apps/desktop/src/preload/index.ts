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
  onMenuAction: (listener: (action: string) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, action: unknown) => {
      if (typeof action !== "string") return;
      listener(action);
    };
    ipcRenderer.on(IPC_CHANNELS.MENU_ACTION, wrapped);
    return () => { ipcRenderer.removeListener(IPC_CHANNELS.MENU_ACTION, wrapped); };
  },
  checkForUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_CHECK),
  downloadUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_DOWNLOAD),
  installUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_INSTALL),
  onUpdateState: (listener: (state: unknown) => void) =>
    forwardEvent(IPC_CHANNELS.UPDATE_STATE, listener),

  // Agent
  sendMessage: (message: string) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_SEND_MESSAGE, message),
  steer: (message: string) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_STEER, message),
  interrupt: () => ipcRenderer.invoke(IPC_CHANNELS.AGENT_INTERRUPT),
  getAgentState: () => ipcRenderer.invoke(IPC_CHANNELS.AGENT_GET_STATE),
  getMessages: () => ipcRenderer.invoke(IPC_CHANNELS.AGENT_GET_MESSAGES),
  clear: () => ipcRenderer.invoke(IPC_CHANNELS.AGENT_CLEAR),
  onAgentEvent: (listener: (event: unknown) => void) =>
    forwardEvent(IPC_CHANNELS.AGENT_EVENT, listener),

  // Auth
  login: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGIN),
  logout: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGOUT),

  // Settings
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
  setSettings: (settings: unknown) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, settings),

  // Tasks
  createTask: (params: unknown) => ipcRenderer.invoke(IPC_CHANNELS.TASK_CREATE, params),
  listTasks: () => ipcRenderer.invoke(IPC_CHANNELS.TASK_LIST),
  deleteTask: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.TASK_DELETE, id),
  toggleTask: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.TASK_TOGGLE, id),
});
