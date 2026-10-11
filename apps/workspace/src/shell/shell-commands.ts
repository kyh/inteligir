// The page's one door into the shell: Tauri's invoke and listen over the rows in
// ipc-contract.ts. Every answer and every event is parsed here against its row, so a page only
// ever holds a value it knows. A rejected command is a fault, never a refusal, and the page words
// it itself. Outside the shell (a browser tab on the same server) there is no door: a surface asks
// underShell() before it draws anything that would knock, and a call made anyway rejects.

import { invoke, isTauri } from "@tauri-apps/api/core";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { z } from "zod";
import { APP_COMMANDS, FIRST_RUN_COMMANDS, UPDATE_STATE_EVENT } from "./ipc-contract";
import type { CommandRoute, EventRoute } from "./ipc-contract";

export const underShell = (): boolean => isTauri();

// a row's call takes exactly its arguments, or nothing for a row that takes none
const command =
  <Args extends z.ZodType<InvokeArgs | undefined>, Answer extends z.ZodType>(
    route: CommandRoute<Args, Answer>,
  ) =>
  async (
    ...args: z.input<Args> extends undefined ? [] : [z.input<Args>]
  ): Promise<z.output<Answer>> =>
    route.answer.parse(await invoke(route.command, route.args.parse(args[0])));

// the listener hears only payloads its row parses; the answer stops it
const event =
  <Payload extends z.ZodType>(route: EventRoute<Payload>) =>
  (listener: (payload: z.output<Payload>) => void): (() => void) => {
    const listening = listen(route.event, (frame) => {
      const parsed = route.payload.safeParse(frame.payload);
      if (parsed.success) {
        listener(parsed.data);
      }
    });
    const stopListening = async (): Promise<void> => {
      const stop = await listening;
      stop();
    };
    return () => {
      void stopListening();
    };
  };

// the shell starts the server, so only it can hand it the debug choice, restart it, or show the
// log it writes and the data folder it lives in
export const shellDiagnostics = {
  getState: command(APP_COMMANDS.diagnostics.getState),
  openDataFolder: command(APP_COMMANDS.diagnostics.openDataFolder),
  restart: command(APP_COMMANDS.diagnostics.restart),
  setDebug: command(APP_COMMANDS.diagnostics.setDebug),
  showLog: command(APP_COMMANDS.diagnostics.showLog),
};

// the OS reaches a vault entry through the shell alone, which resolves and checks the path itself
export const shellPaths = {
  open: command(APP_COMMANDS.paths.open),
  reveal: command(APP_COMMANDS.paths.reveal),
};

// the print panel, as a sheet over the window
export const shellPrint = command(APP_COMMANDS.print);

// the shell reduces the updater's state and pushes every move
export const shellUpdates = {
  check: command(APP_COMMANDS.updates.check),
  download: command(APP_COMMANDS.updates.download),
  getState: command(APP_COMMANDS.updates.getState),
  install: command(APP_COMMANDS.updates.install),
  onState: event(UPDATE_STATE_EVENT),
};

// the vault is the server's, so a switch restarts the child and replaces this window: `pick`
// and `open` answer only when nothing changed (a cancelled picker, a refusal)
export const shellVaults = {
  forget: command(APP_COMMANDS.vaults.forget),
  getState: command(APP_COMMANDS.vaults.getState),
  open: command(APP_COMMANDS.vaults.open),
  pick: command(APP_COMMANDS.vaults.pick),
};

// the first-run window's whole door: before the first boot there is no server, so it asks the
// shell for the vault choice alone. The folders it names are ones the shell handed out, and
// `finish` answers only when no vault opened
export const shellFirstRun = {
  finish: command(FIRST_RUN_COMMANDS.finish),
  getState: command(FIRST_RUN_COMMANDS.getState),
  pickFolder: command(FIRST_RUN_COMMANDS.pickFolder),
  pickParent: command(FIRST_RUN_COMMANDS.pickParent),
};
