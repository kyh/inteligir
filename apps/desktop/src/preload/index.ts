// read synchronously at load: the renderer needs the origin before it opens its first socket.

import { contextBridge, ipcRenderer } from "electron";
import type { z } from "zod";

import { IPC_CHANNELS, socketOriginSchema, toErrorMessage } from "../types";
import type { IpcFrame, DesktopBridge } from "../types";
import { pathActionResultSchema } from "../path-action";
import type { PathActionRequest } from "../path-action";
import { spellcheckStateSchema } from "../spellcheck-state";
import { updateStateSchema } from "../update-state";
import { vaultsStateSchema } from "../vaults-state";

const socketOrigin = socketOriginSchema.parse(ipcRenderer.sendSync(IPC_CHANNELS.SOCKET_ORIGIN));

// the IPC boundary: every frame is parsed here, so the page only ever sees the state it knows;
// a refusal crosses as Electron's wrapped error, and the page gets the sentence main wrote
const INVOKE_PREFIX = /^Error invoking remote method '[^']*': (?:Error: )?/u;

const invokeParsed = async <T>(
  schema: z.ZodType<T>,
  channel: string,
  ...frames: readonly IpcFrame[]
): Promise<T> => {
  try {
    return schema.parse(await ipcRenderer.invoke(channel, ...frames));
  } catch (error) {
    throw new Error(toErrorMessage(error).replace(INVOKE_PREFIX, ""), { cause: error });
  }
};

const updates: DesktopBridge["updates"] = {
  check: async () => await invokeParsed(updateStateSchema, IPC_CHANNELS.UPDATE_CHECK),
  download: async () => await invokeParsed(updateStateSchema, IPC_CHANNELS.UPDATE_DOWNLOAD),
  getState: async () => await invokeParsed(updateStateSchema, IPC_CHANNELS.UPDATE_GET_STATE),
  install: async () => await invokeParsed(updateStateSchema, IPC_CHANNELS.UPDATE_INSTALL),
  onState: (listener) => {
    // typed by electron's own listener signature, so the frame is parsed, never declared
    const relay: Parameters<typeof ipcRenderer.on>[1] = (_event, frame) => {
      const parsed = updateStateSchema.safeParse(frame);
      if (parsed.success) {
        listener(parsed.data);
      }
    };
    ipcRenderer.on(IPC_CHANNELS.UPDATE_STATE, relay);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.UPDATE_STATE, relay);
    };
  },
};

const spellcheck: DesktopBridge["spellcheck"] = {
  apply: async (choice) =>
    await invokeParsed(spellcheckStateSchema, IPC_CHANNELS.SPELLCHECK_APPLY, choice),
  getState: async () =>
    await invokeParsed(spellcheckStateSchema, IPC_CHANNELS.SPELLCHECK_GET_STATE),
};

const paths: DesktopBridge["paths"] = {
  open: async (path) =>
    await invokeParsed(pathActionResultSchema, IPC_CHANNELS.OPEN_PATH, {
      path,
    } satisfies PathActionRequest),
  reveal: async (path) =>
    await invokeParsed(pathActionResultSchema, IPC_CHANNELS.REVEAL_PATH, {
      path,
    } satisfies PathActionRequest),
};

const vaults: DesktopBridge["vaults"] = {
  forget: async (path) => await invokeParsed(vaultsStateSchema, IPC_CHANNELS.VAULTS_FORGET, path),
  getState: async () => await invokeParsed(vaultsStateSchema, IPC_CHANNELS.VAULTS_GET_STATE),
  open: async (path) => await invokeParsed(vaultsStateSchema, IPC_CHANNELS.VAULTS_OPEN, path),
  pick: async () => await invokeParsed(vaultsStateSchema, IPC_CHANNELS.VAULTS_PICK),
};

contextBridge.exposeInMainWorld("desktopBridge", {
  paths,
  socketOrigin,
  spellcheck,
  updates,
  vaults,
} satisfies DesktopBridge);
