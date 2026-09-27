// The first-run window's bridge, and nothing of the app window's: there is no server yet, so no
// socket origin, and nothing but the vault choice is main's to answer before one boots.

import { contextBridge } from "electron";

import { FIRST_RUN_ROUTES } from "../ipc-contract";
import type { FirstRunBridge } from "../types";
import { invoke } from "./invoke";

contextBridge.exposeInMainWorld("firstRunBridge", {
  finish: async (choice) => await invoke(FIRST_RUN_ROUTES.finish, choice),
  getState: async () => await invoke(FIRST_RUN_ROUTES.getState),
  pickFolder: async () => await invoke(FIRST_RUN_ROUTES.pickFolder),
  pickParent: async () => await invoke(FIRST_RUN_ROUTES.pickParent),
} satisfies FirstRunBridge);
