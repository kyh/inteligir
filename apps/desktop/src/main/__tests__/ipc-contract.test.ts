import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as contract from "../../ipc-contract";
import {
  FIRST_RUN_ROUTES,
  INVOKE_ROUTES,
  SOCKET_ORIGIN_CHANNEL,
  UPDATE_STATE_PUSH,
} from "../../ipc-contract";

const channels = [
  ...Object.values(INVOKE_ROUTES).flatMap((arm) =>
    Object.values(arm).map((route) => route.channel),
  ),
  ...Object.values(FIRST_RUN_ROUTES).map((route) => route.channel),
  UPDATE_STATE_PUSH.channel,
  SOCKET_ORIGIN_CHANNEL,
];

describe("the bridge's channels", () => {
  it("names each channel once, because a second `ipcMain.handle` on a channel throws at boot", () => {
    const repeated = channels.filter((channel, index) => channels.indexOf(channel) !== index);
    expect(repeated, "ipc-contract.ts: a channel may be declared by one row only").toEqual([]);
  });
});

const SRC_DIR = path.resolve(import.meta.dirname, "../..");
const MAIN_FILE = "main/index.ts";
const PRELOAD_FILE = "preload/index.ts";
const FIRST_RUN_PRELOAD_FILE = "preload/first-run.ts";

const sourceOf = (file: string): string => readFileSync(path.join(SRC_DIR, file), "utf-8");

const escapeRegExp = (text: string): string => text.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const occurrences = (source: string, pattern: string): number =>
  source.match(new RegExp(pattern, "gu"))?.length ?? 0;

// one end of a channel: the spelling that registers or calls it, and how many of it the file needs
interface ChannelEnd {
  file: string;
  pattern: string;
  spelling: string;
  count: "exactly-one" | "at-least-one";
}

interface ChannelWiring {
  row: string;
  // a channel main answers but no page calls is dead; one the page calls that main never
  // registered answers every call with "No handler registered", at runtime only
  ends: ChannelEnd[];
}

// `callee(argument` as the file writes it, whitespace aside: each end names a row through the one
// wrapper its file spells (`handle`/`invoke`, `push`/`on`), not through every mention of its name
const channelEnd = (
  file: string,
  count: ChannelEnd["count"],
  callee: string,
  argument: string,
): ChannelEnd => ({
  count,
  file,
  pattern: `\\b${escapeRegExp(callee)}\\(\\s*${escapeRegExp(argument)}\\s*[,)]`,
  spelling: `${callee}(${argument}, …)`,
});

const invokeWiring = (): ChannelWiring[] =>
  Object.entries(INVOKE_ROUTES).flatMap(([arm, routes]) =>
    Object.keys(routes).map((route) => {
      const row = `INVOKE_ROUTES.${arm}.${route}`;
      return {
        ends: [
          channelEnd(MAIN_FILE, "exactly-one", "handle", row),
          channelEnd(PRELOAD_FILE, "at-least-one", "invoke", row),
        ],
        row,
      };
    }),
  );

// the first-run window's rows: main answers them only to that window, and only its own preload
// asks them, so the app window's preload may not
const firstRunWiring = (): ChannelWiring[] =>
  Object.keys(FIRST_RUN_ROUTES).map((route) => {
    const row = `FIRST_RUN_ROUTES.${route}`;
    return {
      ends: [
        channelEnd(MAIN_FILE, "exactly-one", "handleFirstRun", row),
        channelEnd(FIRST_RUN_PRELOAD_FILE, "at-least-one", "invoke", row),
      ],
      row,
    };
  });

// every export but the invoke table, by what it is, so a push route or a sync channel is held to
// both ends the day it is declared
const contractExportSchema = z.union([
  z.string().transform(() => "sync-channel" as const),
  z
    .object({ channel: z.string(), frame: z.instanceof(z.ZodType) })
    .transform(() => "push-route" as const),
  z.instanceof(z.ZodType).transform(() => "schema" as const),
]);

const wiringOf = (name: string, kind: z.output<typeof contractExportSchema>): ChannelWiring[] => {
  switch (kind) {
    case "sync-channel": {
      return [
        {
          ends: [
            channelEnd(MAIN_FILE, "exactly-one", "ipcMain.on", name),
            channelEnd(PRELOAD_FILE, "at-least-one", "ipcRenderer.sendSync", name),
          ],
          row: name,
        },
      ];
    }
    case "push-route": {
      return [
        {
          ends: [
            channelEnd(MAIN_FILE, "at-least-one", "push", name),
            channelEnd(PRELOAD_FILE, "at-least-one", "ipcRenderer.on", `${name}.channel`),
          ],
          row: name,
        },
      ];
    }
    case "schema": {
      return [];
    }
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
};

const contractWiring = (): ChannelWiring[] =>
  Object.entries(contract).flatMap(([name, value]) => {
    if (name === "INVOKE_ROUTES") {
      return invokeWiring();
    }
    if (name === "FIRST_RUN_ROUTES") {
      return firstRunWiring();
    }
    const kind = contractExportSchema.safeParse(value);
    if (!kind.success) {
      throw new Error(
        `ipc-contract.ts exports "${name}", which is neither the invoke table, a push route, a sync channel nor a schema.\n` +
          `  rule: every channel the bridge carries is held to both ends, so this guard must know each kind of row\n` +
          `  fix: teach contractExportSchema and wiringOf() the new kind`,
      );
    }
    return wiringOf(name, kind.data);
  });

describe("both ends of the bridge are wired to the contract", () => {
  const sources = new Map(
    [MAIN_FILE, PRELOAD_FILE, FIRST_RUN_PRELOAD_FILE].map((file) => [file, sourceOf(file)]),
  );
  const wiring = contractWiring();

  it("finds every row the contract declares", () => {
    expect(wiring.map((channel) => channel.row)).toHaveLength(channels.length);
  });

  it("keeps each window's rows to its own preload", () => {
    const crossed = [
      ...Object.keys(FIRST_RUN_ROUTES)
        .map((route) => `FIRST_RUN_ROUTES.${route}`)
        .filter((row) => (sources.get(PRELOAD_FILE) ?? "").includes(row)),
      ...((sources.get(FIRST_RUN_PRELOAD_FILE) ?? "").includes("INVOKE_ROUTES")
        ? ["INVOKE_ROUTES"]
        : []),
    ];
    expect(
      crossed,
      "the first-run window has no server and the app window no first run: a row reaches one preload",
    ).toEqual([]);
  });

  it("registers every channel in main and calls it from the preload", () => {
    const violations: string[] = [];
    for (const channel of wiring) {
      for (const end of channel.ends) {
        const found = occurrences(sources.get(end.file) ?? "", end.pattern);
        const wired = end.count === "exactly-one" ? found === 1 : found > 0;
        if (!wired) {
          violations.push(
            `${channel.row}: src/${end.file} spells \`${end.spelling}\` ${String(found)} times, wants ${end.count}`,
          );
        }
      }
    }
    expect(
      violations,
      "a row only one end names fails at runtime alone (No handler registered, or a dead handler); a second handle throws at boot",
    ).toEqual([]);
  });

  it("names no channel as a literal, which no row would declare or parse", () => {
    const literal = /\bipc(?:Main|Renderer)\.\w+\(\s*["'`]/gu;
    const offenders = [...sources].flatMap(([file, source]) =>
      (source.match(literal) ?? []).map((call) => `src/${file}: ${call}`),
    );
    expect(offenders, "spell the channel as a row in src/ipc-contract.ts").toEqual([]);
  });
});
