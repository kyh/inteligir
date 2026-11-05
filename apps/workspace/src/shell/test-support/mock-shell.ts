// The shell's end of the door, for a suite: Tauri's own IPC mock answers each command by the
// name its row gives the shell, after that row's argument parse, so the page's real calls and
// their answer parse run. A command no reply names is refused the way Tauri refuses one its
// capability does not grant, which is how a suite reaches the bridge's fault path; a reply that
// throws rejects as the shell's own error would.
//
// mockIPC fakes the IPC alone, not the marker the runtime sets on every page it hosts, and that
// marker is all isTauri() reads, so the suite sets it too.

import type { MemorySql } from "@repo/library-replica/memory-sql";
import type { ReplicaStatements } from "@repo/library-replica/replica-ports";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { vi } from "vitest";
import { z } from "zod";
import { APP_COMMANDS } from "../ipc-contract";
import type { CommandRoute, FileRoute } from "../ipc-contract";

// invoke sends `{}` for a row that takes nothing, which the shell reads as no arguments
const NO_ARGS_SENT = z.strictObject({});

// the mock's own handler: what it answers is whatever the shell would have sent, unparsed
type IpcHandler = Parameters<typeof mockIPC>[0];

export interface ShellReply {
  readonly command: string;
  readonly answer: IpcHandler;
}

// curried so the row's types are fixed before the answer is checked against them: in one call
// the answer's object literal is typed first, and its `ok: true` widens to a boolean
export const reply =
  <Args extends z.ZodType, Answer extends z.ZodType>(route: CommandRoute<Args, Answer>) =>
  (answer: (args: z.output<Args>) => z.input<Answer> | Promise<z.input<Answer>>): ShellReply => ({
    answer: async (_command, payload) => {
      const nothing = NO_ARGS_SENT.safeParse(payload);
      return await answer(route.args.parse(nothing.success ? undefined : payload));
    },
    command: route.command,
  });

// a row whose request is raw bytes: the mock hands the reply the bytes it was sent (Tauri's mock
// drops the headers beside them)
export const replyBytes =
  <Answer extends z.ZodType>(route: FileRoute<Answer>) =>
  (answer: (bytes: Uint8Array) => z.input<Answer> | Promise<z.input<Answer>>): ShellReply => ({
    answer: async (_command, payload) => await answer(z.instanceof(Uint8Array).parse(payload)),
    command: route.command,
  });

// The shell's replica commands over a database in memory, as the shell's rusqlite answers them
// (src-tauri/src/replica.rs): a statement alone in a transaction of its own, and `begin` holding
// one open under a token until `commit` or `rollback` ends it.
export const replicaReplies = (memory: MemorySql): ShellReply[] => {
  interface Held {
    readonly token: number;
    readonly tx: ReplicaStatements;
    readonly end: {
      readonly resolve: (value: null) => void;
      readonly reject: (cause: Error) => void;
    };
    readonly done: Promise<void>;
  }
  let held: Held | null = null;
  let tokens = 0;
  const open = (token: number): Held => {
    if (held?.token !== token) {
      throw new Error(`no transaction ${String(token)} is open`);
    }
    return held;
  };
  const begin = async (): Promise<number> => {
    const began = Promise.withResolvers<number>();
    const done = memory.exclusive(async (tx) => {
      const end = Promise.withResolvers<null>();
      tokens += 1;
      held = {
        done,
        end,
        token: tokens,
        tx,
      };
      began.resolve(tokens);
      await end.promise;
    });
    // a rollback ends the transaction by rejecting it, which its own caller already heard
    done.catch(() => null);
    return await began.promise;
  };
  const end = async (token: number, commit: boolean): Promise<null> => {
    const { done, end: ending } = open(token);
    held = null;
    if (commit) {
      ending.resolve(null);
    } else {
      ending.reject(new Error("rolled back"));
    }
    await done.catch(() => null);
    return null;
  };
  return [
    reply(APP_COMMANDS.replica.all)(async ({ params, sql }) => [
      ...(await memory.all(sql, params)),
    ]),
    reply(APP_COMMANDS.replica.run)(async ({ params, sql }) => {
      await memory.run(sql, params);
      return null;
    }),
    reply(APP_COMMANDS.replica.begin)(begin),
    reply(APP_COMMANDS.replica.txAll)(async ({ params, sql, token }) => [
      ...(await open(token).tx.all(sql, params)),
    ]),
    reply(APP_COMMANDS.replica.txRun)(async ({ params, sql, token }) => {
      await open(token).tx.run(sql, params);
      return null;
    }),
    reply(APP_COMMANDS.replica.commit)(async ({ token }) => await end(token, true)),
    reply(APP_COMMANDS.replica.rollback)(async ({ token }) => await end(token, false)),
  ];
};

// events are mocked too, so a listener registers and `emit` reaches it as a pushed frame
export const mockShell = (...replies: readonly ShellReply[]): void => {
  const answers = new Map(replies.map(({ answer, command }) => [command, answer]));
  vi.stubGlobal("isTauri", true);
  mockIPC(
    async (command, payload) => {
      const answer = answers.get(command);
      if (answer === undefined) {
        throw new Error(`Command ${command} not allowed by ACL`);
      }
      return await answer(command, payload);
    },
    { shouldMockEvents: true },
  );
};

// unstubs every global the suite stubbed, as vitest's own unstub does
export const clearShell = (): void => {
  clearMocks();
  vi.unstubAllGlobals();
};
