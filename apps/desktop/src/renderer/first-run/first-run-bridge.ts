// The first-run window's whole bridge: before the first boot there is no server, so the page asks
// the shell for the vault choice and nothing else, through the commands its own capability grants.

import { FIRST_RUN_COMMANDS } from "../../ipc-contract";
import type { FirstRunBridge } from "../../types";
import { ask, underShell } from "../shell-commands";

export const firstRunBridge = (): FirstRunBridge | undefined =>
  underShell()
    ? {
        finish: async (choice) => await ask(FIRST_RUN_COMMANDS.finish, { choice }),
        getState: async () => await ask(FIRST_RUN_COMMANDS.getState),
        pickFolder: async () => await ask(FIRST_RUN_COMMANDS.pickFolder),
        pickParent: async () => await ask(FIRST_RUN_COMMANDS.pickParent),
      }
    : undefined;
