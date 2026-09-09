// consola's prompt has no masked kind, so the terminal is read raw: every keystroke lands
// here and nothing is echoed. raw mode disables the terminal's own ^C, so it is handled by hand.

import { buffer } from "node:stream/consumers";
import { CliExitError, invalidUsage } from "../cli-error";

const ENTER = new Set(["\r", "\n"]);
const BACKSPACE = new Set(["\u007F", "\b"]);
const CTRL_C = "\u0003";
const CTRL_D = "\u0004";

export const promptPassword = async (label: string): Promise<string> => {
  const { stdin, stderr } = process;
  stderr.write(`${label}: `);
  stdin.setRawMode(true);
  stdin.setEncoding("utf-8");
  stdin.resume();
  const entered = Promise.withResolvers<string>();
  let typed = "";
  // the handler is passed back in so the two consts do not have to close over each other.
  const finish = (
    handler: (chunk: string) => void,
    outcome: { value: string } | { cause: Error },
  ): void => {
    stdin.off("data", handler);
    stdin.setRawMode(false);
    stdin.pause();
    stderr.write("\n");
    if ("value" in outcome) {
      entered.resolve(outcome.value);
    } else {
      entered.reject(outcome.cause);
    }
  };
  const onData = (chunk: string): void => {
    for (const char of chunk) {
      if (ENTER.has(char)) {
        finish(onData, { value: typed });
        return;
      }
      if (char === CTRL_C || char === CTRL_D) {
        finish(onData, {
          cause: new CliExitError("Interrupted", { code: "INTERRUPTED", exitCode: 130 }),
        });
        return;
      }
      if (BACKSPACE.has(char)) {
        typed = typed.slice(0, -1);
      } else {
        typed += char;
      }
    }
  };
  stdin.on("data", onData);
  return await entered.promise;
};

// one line, its own newline stripped: `printf 'pw\\n' | inteligir cloud login --password -`
export const readPasswordFromStdin = async (): Promise<string> => {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(await buffer(process.stdin));
  const password = text.replace(/\r?\n$/u, "");
  if (password.length === 0) {
    throw invalidUsage("stdin carried no password");
  }
  return password;
};
