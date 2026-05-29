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

  // UI state
  getUiState: () => ipcRenderer.invoke(IPC_CHANNELS.UI_STATE_GET),
  setUiState: (key: string, value: unknown) =>
    ipcRenderer.invoke(IPC_CHANNELS.UI_STATE_SET, { key, value }),

  // Extensions
  listExtensions: () => ipcRenderer.invoke(IPC_CHANNELS.EXTENSIONS_LIST),
  setActiveExtensions: (toolNames: string[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.EXTENSIONS_SET_ACTIVE, toolNames),

  // Shell — reshapeable workspace
  listShell: () => ipcRenderer.invoke(IPC_CHANNELS.SHELL_LIST),
  onShellUpdated: (listener: (next: unknown) => void) =>
    forwardEvent(IPC_CHANNELS.SHELL_UPDATED, listener),
  addWidget: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.SHELL_ADD, input),
  setWidgetGeometry: (geometries: unknown) =>
    ipcRenderer.invoke(IPC_CHANNELS.SHELL_SET_GEOMETRY, geometries),
  setWidgetState: (id: string, state: unknown) =>
    ipcRenderer.invoke(IPC_CHANNELS.SHELL_SET_STATE, { id, state }),
  removeWidget: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.SHELL_REMOVE_WIDGET, id),

  // Live widget actions
  widgetComplete: (prompt: string, system?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.WIDGET_COMPLETE, { prompt, system }),
  widgetFetch: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.WIDGET_FETCH, url),
  widgetOpenUrl: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.WIDGET_OPEN_URL, url),

  // Skills
  listSkills: () => ipcRenderer.invoke(IPC_CHANNELS.SKILLS_LIST),
});
