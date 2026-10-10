// The shell's end of the door, for a suite: Tauri's own IPC mock answers each command by the
// name its row gives the shell, after that row's argument parse, so the page's real calls and
// their answer parse run. A command no reply names is refused the way the shell refuses one its
// capability does not grant, which is how a suite reaches the fault path.
//
// mockIPC fakes the IPC alone, not the marker the runtime sets on every page it hosts, and that
// marker is all isTauri() reads, so the suite sets it too.

import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { vi } from "vitest";
import { z } from "zod";
import type { CommandRoute } from "../../ipc-contract";

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
    answer: async (_command, payload) =>
      await answer(route.args.parse(NO_ARGS_SENT.safeParse(payload).success ? undefined : payload)),
    command: route.command,
  });

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
