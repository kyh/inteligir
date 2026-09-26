// The first-run window's bridge, and nothing of the app window's: there is no server yet, so no
// socket origin, and nothing but the vault choice is main's to answer before one boots.

import { contextBridge, ipcRenderer } from "electron";
import type { z } from "zod";

import { FIRST_RUN_ROUTES } from "../ipc-contract";
import type { InvokeRoute } from "../ipc-contract";
import type { FirstRunBridge } from "../types";

// every answer is parsed here, so the page only ever sees a value it knows
const invoke = async <Request extends z.ZodType, Answer extends z.ZodType>(
  route: InvokeRoute<Request, Answer>,
  ...request: z.input<Request> extends undefined ? [] : [z.input<Request>]
): Promise<z.output<Answer>> =>
  route.answer.parse(await ipcRenderer.invoke(route.channel, ...request));

contextBridge.exposeInMainWorld("firstRunBridge", {
  finish: async (choice) => await invoke(FIRST_RUN_ROUTES.finish, choice),
  getState: async () => await invoke(FIRST_RUN_ROUTES.getState),
  pickFolder: async () => await invoke(FIRST_RUN_ROUTES.pickFolder),
  pickParent: async () => await invoke(FIRST_RUN_ROUTES.pickParent),
} satisfies FirstRunBridge);
