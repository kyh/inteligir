import type { CommandDef } from "citty";
import type { CliDeps } from "../context";
import { buildProgram } from "../program";

export const testProgram = (): CommandDef => {
  const deps: CliDeps = {
    env: {},
    openExternalUrl: async () => false,
    resolveServer: () => ({
      baseUrl: "http://127.0.0.1:0",
      dataDir: "/fixture/data",
      token: "unused",
    }),
  };
  return buildProgram(deps);
};

export const LEAF_INVOCATIONS = new Map<string, readonly string[]>([
  ["action list", ["action", "list"]],
  ["action new", ["action", "new", "do a thing"]],
  ["action send", ["action", "send", "thr_1", "and then?"]],
  ["action show", ["action", "show", "thr_1"]],
  ["action stop", ["action", "stop", "thr_1"]],
  ["action wait", ["action", "wait", "thr_1", "--timeout", "2", "--poll-interval", "20"]],
  ["action archive", ["action", "archive", "thr_1"]],
  ["interactions list", ["interactions", "list"]],
  ["interactions answer", ["interactions", "answer", "int_1", "allow_once"]],
  ["cloud status", ["cloud", "status"]],
  [
    "cloud login",
    ["cloud", "login", "--email", "owner@example.test", "--password", "correct-horse-battery"],
  ],
  ["cloud sync", ["cloud", "sync"]],
  ["status", ["status"]],
  ["open", ["open"]],
]);
