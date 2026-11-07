// The page's one door into the shell: Tauri's invoke and listen over the rows in ipc-contract.ts.
// Every answer and every event is parsed here against its row, so a page only ever holds a value
// it knows, and every rejection is read as the shell's error (`shell-error.ts`). Outside the shell
// (the library's browser tab) there is no door: a surface asks underShell() before it draws
// anything that would knock, and a call made anyway rejects.

import { invoke, isTauri } from "@tauri-apps/api/core";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  ReplicaSql,
  ReplicaStatements,
  StagedBlobs,
} from "@repo/library-replica/replica-ports";
import { serialLock } from "@repo/library-replica/serial-lock";
import type { z } from "zod";
import { APP_COMMANDS, LEAVING_EVENT, UPDATE_STATE_EVENT } from "./ipc-contract";
import type { CommandRoute, EventRoute, FileRoute } from "./ipc-contract";
import { ShellError, shellErrorOf } from "./shell-error";

export const underShell = (): boolean => isTauri();

// a row's call takes exactly its arguments, or nothing for a row that takes none
const command =
  <Args extends z.ZodType<InvokeArgs | undefined>, Answer extends z.ZodType>(
    route: CommandRoute<Args, Answer>,
  ) =>
  async (
    ...args: z.input<Args> extends undefined ? [] : [z.input<Args>]
  ): Promise<z.output<Answer>> => {
    let answered: unknown;
    try {
      answered = await invoke(route.command, route.args.parse(args[0]));
    } catch (error) {
      throw shellErrorOf(error);
    }
    return route.answer.parse(answered);
  };

const fileCommand =
  <Answer extends z.ZodType>(route: FileRoute<Answer>) =>
  async (
    file: { readonly sha: string; readonly type: string },
    bytes: Uint8Array<ArrayBuffer>,
  ): Promise<z.output<Answer>> => {
    let answered: unknown;
    try {
      answered = await invoke(route.command, bytes, {
        headers: { [route.shaHeader]: file.sha, [route.typeHeader]: file.type },
      });
    } catch (error) {
      throw shellErrorOf(error);
    }
    return route.answer.parse(answered);
  };

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

export const shellConfig = command(APP_COMMANDS.config);

export const shellCredential = {
  forget: command(APP_COMMANDS.credential.forget),
  keep: command(APP_COMMANDS.credential.keep),
  restore: command(APP_COMMANDS.credential.restore),
};

// the shell asks before it quits or restarts, and goes once the page answers or a moment passes
export const shellLeaving = {
  onLeaving: event(LEAVING_EVENT),
  ready: command(APP_COMMANDS.leaving.ready),
};

// the shell reduces the updater's state and pushes every move
export const shellUpdates = {
  check: command(APP_COMMANDS.updates.check),
  getState: command(APP_COMMANDS.updates.getState),
  install: command(APP_COMMANDS.updates.install),
  onState: event(UPDATE_STATE_EVENT),
};

const replica = {
  all: command(APP_COMMANDS.replica.all),
  begin: command(APP_COMMANDS.replica.begin),
  commit: command(APP_COMMANDS.replica.commit),
  rollback: command(APP_COMMANDS.replica.rollback),
  run: command(APP_COMMANDS.replica.run),
  txAll: command(APP_COMMANDS.replica.txAll),
  txRun: command(APP_COMMANDS.replica.txRun),
};

// The Mac's replica as the engine's port: the shell's SQLite, one statement a command. Every call
// waits its turn in the order it was made, so a statement outside a transaction waits out a running
// one; `exclusive` opens a transaction the shell holds under a token, runs `work`'s statements on
// it, commits when `work` resolves and rolls back when it throws, so a failed statement inside
// lands nothing of the transaction.
export const shellReplicaSql = (): ReplicaSql => {
  const serial = serialLock();
  return {
    all: async (sql, params) =>
      await serial(async () => await replica.all({ params: [...params], sql })),
    exclusive: async (work) =>
      await serial(async () => {
        const token = await replica.begin();
        const tx: ReplicaStatements = {
          all: async (sql, params) => await replica.txAll({ params: [...params], sql, token }),
          run: async (sql, params) => {
            await replica.txRun({ params: [...params], sql, token });
          },
        };
        let value: Awaited<ReturnType<typeof work>>;
        try {
          value = await work(tx);
        } catch (error) {
          await replica.rollback({ token });
          throw error;
        }
        await replica.commit({ token });
        return value;
      }),
    run: async (sql, params) => {
      await serial(async () => {
        await replica.run({ params: [...params], sql });
      });
    },
  };
};

const files = {
  clearStaged: command(APP_COMMANDS.files.clearStaged),
  stage: fileCommand(APP_COMMANDS.files.stage),
  staged: command(APP_COMMANDS.files.staged),
  unstage: command(APP_COMMANDS.files.unstage),
};

// The outbox's staged files as the shell keeps them: pinned in the app's data dir with their type
// until the write naming each lands, then handed to the shell's cache, where the next read finds
// them unfetched; the scheme serves each as its type all the while.
export const shellStagedBlobs = (): StagedBlobs => ({
  clear: async () => {
    await files.clearStaged();
  },
  put: async (sha, bytes, mime) => {
    await files.stage({ sha, type: mime }, bytes);
  },
  read: async (sha) => {
    try {
      return await files.staged({ sha });
    } catch (error) {
      if (error instanceof ShellError && error.kind === "missing") {
        return null;
      }
      throw error;
    }
  },
  remove: async (sha) => {
    await files.unstage({ sha });
  },
});
