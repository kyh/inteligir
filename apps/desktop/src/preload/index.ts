import { contextBridge, ipcRenderer } from "electron";
import type { z } from "zod";

import {
  INVOKE_ROUTES,
  SOCKET_ORIGIN_CHANNEL,
  socketOriginSchema,
  UPDATE_STATE_PUSH,
} from "../ipc-contract";
import type { InvokeRoute } from "../ipc-contract";
import type { DesktopBridge } from "../types";

// read synchronously at load: the renderer needs the origin before it opens its first socket.
const socketOrigin = socketOriginSchema.parse(ipcRenderer.sendSync(SOCKET_ORIGIN_CHANNEL));

// the IPC boundary: every answer is parsed here, so the page only ever sees a value it knows.
// A throw that crosses is a fault, not a refusal, and the page words it itself.
const invoke = async <Request extends z.ZodType, Answer extends z.ZodType>(
  route: InvokeRoute<Request, Answer>,
  ...request: z.input<Request> extends undefined ? [] : [z.input<Request>]
): Promise<z.output<Answer>> =>
  route.answer.parse(await ipcRenderer.invoke(route.channel, ...request));

const updates: DesktopBridge["updates"] = {
  check: async () => await invoke(INVOKE_ROUTES.updates.check),
  download: async () => await invoke(INVOKE_ROUTES.updates.download),
  getState: async () => await invoke(INVOKE_ROUTES.updates.getState),
  install: async () => await invoke(INVOKE_ROUTES.updates.install),
  onState: (listener) => {
    // typed by electron's own listener signature, so the frame is parsed, never declared
    const relay: Parameters<typeof ipcRenderer.on>[1] = (_event, frame) => {
      const parsed = UPDATE_STATE_PUSH.frame.safeParse(frame);
      if (parsed.success) {
        listener(parsed.data);
      }
    };
    ipcRenderer.on(UPDATE_STATE_PUSH.channel, relay);
    return () => {
      ipcRenderer.removeListener(UPDATE_STATE_PUSH.channel, relay);
    };
  },
};

const spellcheck: DesktopBridge["spellcheck"] = {
  apply: async (choice) => await invoke(INVOKE_ROUTES.spellcheck.apply, choice),
  getState: async () => await invoke(INVOKE_ROUTES.spellcheck.getState),
};

const paths: DesktopBridge["paths"] = {
  open: async (path) => await invoke(INVOKE_ROUTES.paths.open, { path }),
  reveal: async (path) => await invoke(INVOKE_ROUTES.paths.reveal, { path }),
};

const vaults: DesktopBridge["vaults"] = {
  forget: async (path) => await invoke(INVOKE_ROUTES.vaults.forget, path),
  getState: async () => await invoke(INVOKE_ROUTES.vaults.getState),
  open: async (path) => await invoke(INVOKE_ROUTES.vaults.open, path),
  pick: async () => await invoke(INVOKE_ROUTES.vaults.pick),
};

contextBridge.exposeInMainWorld("desktopBridge", {
  paths,
  socketOrigin,
  spellcheck,
  updates,
  vaults,
} satisfies DesktopBridge);
