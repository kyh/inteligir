// the browser extension's door: Chrome starts it with the extension's origin and speaks framed
// messages on its stdin and stdout for its whole life, so it prints nothing of its own and answers
// its exit code through process.exitCode rather than a failure line.

import { defineCommand } from "citty";
import type { CliDeps } from "../context";

export const nativeHostCommand = (deps: CliDeps) =>
  defineCommand({
    args: {
      install: {
        default: false,
        description: "Write this checkout's browser door for the dev extension (dev only)",
        type: "boolean",
      },
      json: {
        default: false,
        description: "Accepted and unused: the frames are JSON",
        type: "boolean",
      },
      origin: {
        description: "The extension's origin, which Chrome passes",
        required: false,
        type: "positional",
      },
    },
    meta: {
      description: "the browser extension's door; Chrome starts it, never run it yourself",
      hidden: true,
      name: "native-host",
    },
    run: async ({ args }) => {
      const { runNativeHostLeaf } = await import("../native-host/run-native-host");
      process.exitCode = await runNativeHostLeaf(args, deps);
    },
  });
