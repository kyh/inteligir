// The desktop shell's door into the CLI. One question per process (desktop-door.ts), answered as
// one JSON line, `{"answer": …}` or `{"reason": …}`; a fault exits non-zero with its message on
// stderr. `serve` is the one that stays: it is the server (desktop-serve.ts).
//
// Not an `inteligir` verb: the shell and this entry ship in one bundle, so its wire may break
// freely, like /local's, and agents never meet it. Built as dist/desktop.js beside the CLI.

import { homedir } from "node:os";
import { messageOf } from "../server/error-message";
import { answerDoor, doorTargetArgs } from "./desktop-door";
import type { DoorContext } from "./desktop-door";
import { desktopServe } from "./desktop-serve";

const context: DoorContext = { env: process.env, homeDir: homedir() };
const [verb, ...args] = process.argv.slice(2);
try {
  if (verb === "serve") {
    await desktopServe(doorTargetArgs(context), args.includes("--debug"));
  } else {
    process.stdout.write(`${JSON.stringify(await answerDoor(context, verb, args))}\n`);
  }
} catch (error) {
  process.stderr.write(`${messageOf(error)}\n`);
  process.exitCode = 1;
}
