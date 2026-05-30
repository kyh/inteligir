import { contextBridge, ipcRenderer } from "electron";

import { IPC_CHANNELS, type DesktopBridge } from "@/shared/ipc";

function forwardEvent<T>(channel: string, listener: (data: T) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, data: T) => {
    listener(data);
  };
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

const desktopBridge: DesktopBridge = {
  // Desktop
  checkForUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_CHECK),
  downloadUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_DOWNLOAD),
  installUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_INSTALL),
  onUpdateState: (listener) => forwardEvent(IPC_CHANNELS.UPDATE_STATE, listener),

  // App lifecycle
  getAppState: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_STATE),
  transition: (event) => ipcRenderer.invoke(IPC_CHANNELS.APP_TRANSITION, event),
  onAppState: (listener) => forwardEvent(IPC_CHANNELS.APP_STATE, listener),
  onSetupProgress: (listener) => forwardEvent(IPC_CHANNELS.SETUP_PROGRESS, listener),

  // Agent
  onAgentEvent: (listener) => forwardEvent(IPC_CHANNELS.AGENT_EVENT, listener),
  sendAgentCommand: (command) => ipcRenderer.invoke(IPC_CHANNELS.AGENT_COMMAND, command),
  getAgentHistory: () => ipcRenderer.invoke(IPC_CHANNELS.AGENT_HISTORY),

  // Tasks
  createTask: (params) => ipcRenderer.invoke(IPC_CHANNELS.TASK_CREATE, params),
  listTasks: () => ipcRenderer.invoke(IPC_CHANNELS.TASK_LIST),
  deleteTask: (id) => ipcRenderer.invoke(IPC_CHANNELS.TASK_DELETE, id),
  toggleTask: (id) => ipcRenderer.invoke(IPC_CHANNELS.TASK_TOGGLE, id),

  // Voice
  getVoiceConfig: () => ipcRenderer.invoke(IPC_CHANNELS.VOICE_CONFIG),
  startStt: () => ipcRenderer.invoke(IPC_CHANNELS.VOICE_STT_START),
  sendSttAudio: (samples) => ipcRenderer.send(IPC_CHANNELS.VOICE_STT_AUDIO, samples),
  stopStt: () => ipcRenderer.invoke(IPC_CHANNELS.VOICE_STT_STOP),
  onSttTranscript: (listener) => forwardEvent(IPC_CHANNELS.VOICE_STT_TRANSCRIPT, listener),
  getVoiceModelStatus: () => ipcRenderer.invoke(IPC_CHANNELS.VOICE_MODEL_STATUS),
  downloadVoiceModel: () => ipcRenderer.invoke(IPC_CHANNELS.VOICE_MODEL_DOWNLOAD),
  onVoiceModelState: (listener) => forwardEvent(IPC_CHANNELS.VOICE_MODEL_STATE, listener),

  // Notifications
  getNotificationSettings: () => ipcRenderer.invoke(IPC_CHANNELS.NOTIFICATIONS_GET),
  updateNotificationSettings: (patch) =>
    ipcRenderer.invoke(IPC_CHANNELS.NOTIFICATIONS_UPDATE, patch),

  // UI state
  getUiState: () => ipcRenderer.invoke(IPC_CHANNELS.UI_STATE_GET),
  setUiState: (key, value) => ipcRenderer.invoke(IPC_CHANNELS.UI_STATE_SET, { key, value }),

  // Extensions
  listExtensions: () => ipcRenderer.invoke(IPC_CHANNELS.EXTENSIONS_LIST),
  setActiveExtensions: (toolNames) =>
    ipcRenderer.invoke(IPC_CHANNELS.EXTENSIONS_SET_ACTIVE, toolNames),

  // Shell — OS-like workspace
  listShell: () => ipcRenderer.invoke(IPC_CHANNELS.SHELL_LIST),
  onShellUpdated: (listener) => forwardEvent(IPC_CHANNELS.SHELL_UPDATED, listener),
  installWidget: (input) => ipcRenderer.invoke(IPC_CHANNELS.SHELL_INSTALL, input),
  placeWidget: (widgetId, surface) =>
    ipcRenderer.invoke(IPC_CHANNELS.SHELL_PLACE, { widgetId, surface }),
  unplaceWidget: (instanceId) => ipcRenderer.invoke(IPC_CHANNELS.SHELL_UNPLACE, instanceId),
  deleteWidget: (widgetId, expectedRevision) =>
    ipcRenderer.invoke(IPC_CHANNELS.SHELL_DELETE, { widgetId, expectedRevision }),
  setInstanceGeometry: (geometries) =>
    ipcRenderer.invoke(IPC_CHANNELS.SHELL_SET_GEOMETRY, geometries),
  setInstanceRect: (instanceId, rect) =>
    ipcRenderer.invoke(IPC_CHANNELS.SHELL_SET_RECT, { instanceId, rect }),
  setInstanceSurface: (instanceId, surface) =>
    ipcRenderer.invoke(IPC_CHANNELS.SHELL_SET_SURFACE, { instanceId, surface }),
  focusInstance: (instanceId) => ipcRenderer.invoke(IPC_CHANNELS.SHELL_FOCUS, instanceId),
  setInstanceState: (instanceId, state) =>
    ipcRenderer.invoke(IPC_CHANNELS.SHELL_SET_STATE, { instanceId, state }),
  onWidgetFlushRequest: (listener) => forwardEvent(IPC_CHANNELS.SHELL_FLUSH_REQUEST, listener),
  ackWidgetFlush: (requestId, persisted) =>
    ipcRenderer.send(IPC_CHANNELS.SHELL_FLUSH_ACK, { requestId, persisted }),

  // Live widget actions
  widgetSendPrompt: (prompt) => ipcRenderer.invoke(IPC_CHANNELS.WIDGET_SEND_PROMPT, { prompt }),
  widgetComplete: (prompt, system) =>
    ipcRenderer.invoke(IPC_CHANNELS.WIDGET_COMPLETE, { prompt, system }),
  widgetFetch: (url) => ipcRenderer.invoke(IPC_CHANNELS.WIDGET_FETCH, { url }),
  widgetOpenUrl: (url) => ipcRenderer.invoke(IPC_CHANNELS.WIDGET_OPEN_URL, { url }),

  // Executor (integration backend)
  executorStatus: () => ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_STATUS),
  listExecutorSources: () => ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_SOURCES_LIST),
  detectExecutorSource: (url) => ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_SOURCES_DETECT, url),
  addMcpSource: (input) => ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_SOURCE_ADD_MCP, input),
  addOpenApiSource: (input) => ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_SOURCE_ADD_OPENAPI, input),
  addGraphqlSource: (input) => ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_SOURCE_ADD_GRAPHQL, input),
  addGoogleSource: (input) => ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_SOURCE_ADD_GOOGLE, input),
  removeExecutorSource: (sourceId) =>
    ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_SOURCE_REMOVE, sourceId),
  refreshExecutorSource: (sourceId) =>
    ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_SOURCE_REFRESH, sourceId),
  listExecutorSecrets: () => ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_SECRETS_LIST),
  setExecutorSecret: (input) => ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_SECRET_SET, input),
  removeExecutorSecret: (secretId) =>
    ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_SECRET_REMOVE, secretId),
  listExecutorConnections: () => ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_CONNECTIONS_LIST),
  removeExecutorConnection: (connectionId) =>
    ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_CONNECTION_REMOVE, connectionId),
  listExecutorTools: () => ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_TOOLS_LIST),
  executorExecute: (code) => ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_EXECUTE, code),
  executorOAuthStart: (input) => ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_OAUTH_START, input),
  executorOAuthAwait: (sessionId) =>
    ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_OAUTH_AWAIT, sessionId),
  executorOpenExternal: (url) => ipcRenderer.invoke(IPC_CHANNELS.EXECUTOR_OPEN_EXTERNAL, url),

  // Skills
  listSkills: () => ipcRenderer.invoke(IPC_CHANNELS.SKILLS_LIST),

  // Integrations
  listIntegrations: () => ipcRenderer.invoke(IPC_CHANNELS.INTEGRATIONS_LIST),
  repairIntegrations: () => ipcRenderer.invoke(IPC_CHANNELS.INTEGRATIONS_REPAIR),
};

contextBridge.exposeInMainWorld("desktopBridge", desktopBridge);
