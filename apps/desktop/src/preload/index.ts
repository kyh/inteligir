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

  // Shell — OS-like workspace
  listShell: () => ipcRenderer.invoke(IPC_CHANNELS.SHELL_LIST),
  onShellUpdated: (listener: (next: unknown) => void) =>
    forwardEvent(IPC_CHANNELS.SHELL_UPDATED, listener),
  createWidget: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.SHELL_CREATE, input),
  placeWidget: (widgetId: string, surface?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SHELL_PLACE, { widgetId, surface }),
  unplaceWidget: (instanceId: string) => ipcRenderer.invoke(IPC_CHANNELS.SHELL_UNPLACE, instanceId),
  deleteWidget: (widgetId: string) => ipcRenderer.invoke(IPC_CHANNELS.SHELL_DELETE, widgetId),
  setInstanceGeometry: (geometries: unknown) =>
    ipcRenderer.invoke(IPC_CHANNELS.SHELL_SET_GEOMETRY, geometries),
  setInstanceRect: (instanceId: string, rect: unknown) =>
    ipcRenderer.invoke(IPC_CHANNELS.SHELL_SET_RECT, { instanceId, rect }),
  setInstanceSurface: (instanceId: string, surface: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SHELL_SET_SURFACE, { instanceId, surface }),
  focusInstance: (instanceId: string) => ipcRenderer.invoke(IPC_CHANNELS.SHELL_FOCUS, instanceId),
  setInstanceState: (instanceId: string, state: unknown) =>
    ipcRenderer.invoke(IPC_CHANNELS.SHELL_SET_STATE, { instanceId, state }),
  onWidgetFlushRequest: (listener: (payload: unknown) => void) =>
    forwardEvent(IPC_CHANNELS.SHELL_FLUSH_REQUEST, listener),
  ackWidgetFlush: (requestId: string) =>
    ipcRenderer.send(IPC_CHANNELS.SHELL_FLUSH_ACK, { requestId }),

  // Live widget actions
  widgetComplete: (prompt: string, system?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.WIDGET_COMPLETE, { prompt, system }),
  widgetFetch: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.WIDGET_FETCH, url),
  widgetOpenUrl: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.WIDGET_OPEN_URL, url),

  // Executor (integration backend)
  executorStatus: () => ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_STATUS),
  listExecutorSources: () => ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_SOURCES_LIST),
  detectExecutorSource: (url: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_SOURCES_DETECT, url),
  addMcpSource: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_SOURCE_ADD_MCP, input),
  addOpenApiSource: (input: unknown) =>
    ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_SOURCE_ADD_OPENAPI, input),
  addGraphqlSource: (input: unknown) =>
    ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_SOURCE_ADD_GRAPHQL, input),
  addGoogleSource: (input: unknown) =>
    ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_SOURCE_ADD_GOOGLE, input),
  removeExecutorSource: (sourceId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_SOURCE_REMOVE, sourceId),
  refreshExecutorSource: (sourceId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_SOURCE_REFRESH, sourceId),
  listExecutorSecrets: () => ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_SECRETS_LIST),
  setExecutorSecret: (input: unknown) => ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_SECRET_SET, input),
  removeExecutorSecret: (secretId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_SECRET_REMOVE, secretId),
  listExecutorConnections: () => ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_CONNECTIONS_LIST),
  removeExecutorConnection: (connectionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_CONNECTION_REMOVE, connectionId),
  listExecutorTools: () => ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_TOOLS_LIST),
  executorExecute: (code: string) => ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_EXECUTE, code),
  executorOAuthStart: (input: unknown) =>
    ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_OAUTH_START, input),
  executorOAuthAwait: (sessionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_OAUTH_AWAIT, sessionId),
  executorOpenExternal: (url: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_OPEN_EXTERNAL, url),

  // Skills
  listSkills: () => ipcRenderer.invoke(IPC_CHANNELS.SKILLS_LIST),

  // Integrations
  listIntegrations: () => ipcRenderer.invoke(IPC_CHANNELS.INTEGRATIONS_LIST),
  repairIntegrations: () => ipcRenderer.invoke(IPC_CHANNELS.INTEGRATIONS_REPAIR),
});
