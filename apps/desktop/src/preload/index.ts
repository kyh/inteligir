import { contextBridge, ipcRenderer } from "electron";

import { IPC_CHANNELS } from "@/shared/ipc";

function forwardEvent(channel: string, listener: (data: unknown) => void): () => void {
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
  onSetupProgress: (listener: (progress: unknown) => void) =>
    forwardEvent(IPC_CHANNELS.SETUP_PROGRESS, listener),

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

  // Voice
  getVoiceConfig: () => ipcRenderer.invoke(IPC_CHANNELS.VOICE_CONFIG),
  startStt: () => ipcRenderer.invoke(IPC_CHANNELS.VOICE_STT_START),
  sendSttAudio: (samples: ArrayBuffer) => ipcRenderer.send(IPC_CHANNELS.VOICE_STT_AUDIO, samples),
  stopStt: () => ipcRenderer.invoke(IPC_CHANNELS.VOICE_STT_STOP),
  onSttTranscript: (listener: (event: unknown) => void) =>
    forwardEvent(IPC_CHANNELS.VOICE_STT_TRANSCRIPT, listener),
  getVoiceModelStatus: () => ipcRenderer.invoke(IPC_CHANNELS.VOICE_MODEL_STATUS),
  downloadVoiceModel: () => ipcRenderer.invoke(IPC_CHANNELS.VOICE_MODEL_DOWNLOAD),
  onVoiceModelState: (listener: (event: unknown) => void) =>
    forwardEvent(IPC_CHANNELS.VOICE_MODEL_STATE, listener),

  // Notifications
  getNotificationSettings: () => ipcRenderer.invoke(IPC_CHANNELS.NOTIFICATIONS_GET),
  updateNotificationSettings: (patch: unknown) =>
    ipcRenderer.invoke(IPC_CHANNELS.NOTIFICATIONS_UPDATE, patch),

  // Extensions
  listExtensions: () => ipcRenderer.invoke(IPC_CHANNELS.EXTENSIONS_LIST),
  setActiveExtensions: (toolNames: string[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.EXTENSIONS_SET_ACTIVE, toolNames),
});
