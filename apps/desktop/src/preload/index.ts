// read synchronously at load: the renderer needs the origin before it opens its first socket.

import { contextBridge, ipcRenderer } from "electron";
import type { z } from "zod";

import { IPC_CHANNELS, socketOriginSchema, toErrorMessage, type IpcFrame } from "../types";
import type { DesktopBridge } from "../types";
import { pathActionResultSchema, type PathActionRequest } from "../path-action";
import { spellcheckStateSchema } from "../spellcheck-state";
import { updateStateSchema } from "../update-state";
import { vaultsStateSchema } from "../vaults-state";

const socketOrigin = socketOriginSchema.parse(ipcRenderer.sendSync(IPC_CHANNELS.SOCKET_ORIGIN));

// the IPC boundary: every frame is parsed here, so the page only ever sees the state it knows;
// a refusal crosses as Electron's wrapped error, and the page gets the sentence main wrote
const INVOKE_PREFIX = /^Error invoking remote method '[^']*': (?:Error: )?/u;

async function invokeParsed<T>(
  schema: z.ZodType<T>,
  channel: string,
  ...frames: readonly IpcFrame[]
): Promise<T> {
  try {
    return schema.parse(await ipcRenderer.invoke(channel, ...frames));
  } catch (cause) {
    throw new Error(toErrorMessage(cause).replace(INVOKE_PREFIX, ""), { cause });
  }
}

const updates: DesktopBridge["updates"] = {
  getState: () => invokeParsed(updateStateSchema, IPC_CHANNELS.UPDATE_GET_STATE),
  check: () => invokeParsed(updateStateSchema, IPC_CHANNELS.UPDATE_CHECK),
  download: () => invokeParsed(updateStateSchema, IPC_CHANNELS.UPDATE_DOWNLOAD),
  install: () => invokeParsed(updateStateSchema, IPC_CHANNELS.UPDATE_INSTALL),
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
  getState: async () => invokeParsed(spellcheckStateSchema, IPC_CHANNELS.SPELLCHECK_GET_STATE),
  apply: async (choice) =>
    invokeParsed(spellcheckStateSchema, IPC_CHANNELS.SPELLCHECK_APPLY, choice),
};

const paths: DesktopBridge["paths"] = {
  reveal: async (path) =>
    invokeParsed(pathActionResultSchema, IPC_CHANNELS.REVEAL_PATH, {
      path,
    } satisfies PathActionRequest),
  open: async (path) =>
    invokeParsed(pathActionResultSchema, IPC_CHANNELS.OPEN_PATH, {
      path,
    } satisfies PathActionRequest),
};

const vaults: DesktopBridge["vaults"] = {
  getState: () => invokeParsed(vaultsStateSchema, IPC_CHANNELS.VAULTS_GET_STATE),
  pick: () => invokeParsed(vaultsStateSchema, IPC_CHANNELS.VAULTS_PICK),
  open: (path) => invokeParsed(vaultsStateSchema, IPC_CHANNELS.VAULTS_OPEN, path),
  forget: (path) => invokeParsed(vaultsStateSchema, IPC_CHANNELS.VAULTS_FORGET, path),
};

contextBridge.exposeInMainWorld("desktopBridge", {
  socketOrigin,
  updates,
  spellcheck,
  paths,
  vaults,
} satisfies DesktopBridge);
