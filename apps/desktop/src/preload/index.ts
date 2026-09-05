// read synchronously at load: the renderer needs the origin before it opens its first socket.

import { contextBridge, ipcRenderer } from "electron";

import { IPC_CHANNELS, socketOriginSchema } from "../types";
import type { DesktopBridge } from "../types";
import { pathActionResultSchema, type PathActionRequest } from "../path-action";
import { spellcheckStateSchema } from "../spellcheck-state";
import { updateStateSchema, type UpdateState } from "../update-state";
import { vaultsStateSchema, type VaultsState } from "../vaults-state";

const socketOrigin = socketOriginSchema.parse(ipcRenderer.sendSync(IPC_CHANNELS.SOCKET_ORIGIN));

// the IPC boundary: every frame is parsed here, so the page only ever sees the state it knows
async function invokeForState(channel: string): Promise<UpdateState> {
  return updateStateSchema.parse(await ipcRenderer.invoke(channel));
}

const updates: DesktopBridge["updates"] = {
  getState: () => invokeForState(IPC_CHANNELS.UPDATE_GET_STATE),
  check: () => invokeForState(IPC_CHANNELS.UPDATE_CHECK),
  download: () => invokeForState(IPC_CHANNELS.UPDATE_DOWNLOAD),
  install: () => invokeForState(IPC_CHANNELS.UPDATE_INSTALL),
  onState: (listener) => {
    // typed by electron's own listener signature, so the frame is parsed, never declared
    const relay: Parameters<typeof ipcRenderer.on>[1] = (_event, frame) => {
      const parsed = updateStateSchema.safeParse(frame);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on(IPC_CHANNELS.UPDATE_STATE, relay);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.UPDATE_STATE, relay);
    };
  },
};

const spellcheck: DesktopBridge["spellcheck"] = {
  getState: async () =>
    spellcheckStateSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.SPELLCHECK_GET_STATE)),
  apply: async (choice) =>
    spellcheckStateSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.SPELLCHECK_APPLY, choice)),
};

const paths: DesktopBridge["paths"] = {
  reveal: async (path) =>
    pathActionResultSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.REVEAL_PATH, { path } satisfies PathActionRequest),
    ),
  open: async (path) =>
    pathActionResultSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.OPEN_PATH, { path } satisfies PathActionRequest),
    ),
};

// a refusal crosses as Electron's wrapped error; the page gets the sentence main wrote
const INVOKE_PREFIX = /^Error invoking remote method '[^']*': (?:Error: )?/u;

async function invokeForVaults(channel: string, ...frames: unknown[]): Promise<VaultsState> {
  try {
    return vaultsStateSchema.parse(await ipcRenderer.invoke(channel, ...frames));
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(message.replace(INVOKE_PREFIX, ""), { cause });
  }
}

const vaults: DesktopBridge["vaults"] = {
  getState: () => invokeForVaults(IPC_CHANNELS.VAULTS_GET_STATE),
  pick: () => invokeForVaults(IPC_CHANNELS.VAULTS_PICK),
  open: (path) => invokeForVaults(IPC_CHANNELS.VAULTS_OPEN, path),
  forget: (path) => invokeForVaults(IPC_CHANNELS.VAULTS_FORGET, path),
};

contextBridge.exposeInMainWorld("desktopBridge", {
  socketOrigin,
  updates,
  spellcheck,
  paths,
  vaults,
} satisfies DesktopBridge);
