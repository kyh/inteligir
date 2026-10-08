import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEV_DATA_ROOT_DIR } from "inteligir/server/config";
import { makeTempDir } from "inteligir/server/testing";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { answerDoor, doorTargetArgs } from "../desktop-door";
import { resolveServerTarget } from "../server-start";
import type { DoorContext, DoorReply } from "../desktop-door";

// a checkout's launch on a home of its own: no login shell is asked, so the door touches nothing
// outside the scratch home
const scratch = (env: NodeJS.ProcessEnv = {}): DoorContext => ({
  env,
  homeDir: makeTempDir("inteligir-door-"),
});

// the shape the shell reads (apps/desktop/src-tauri/src/launch.rs), parsed as it parses it
const launchAnswer = z.strictObject({
  env: z.record(z.string(), z.string()),
  firstLaunch: z.boolean(),
  notes: z.array(z.string()),
  target: z.strictObject({ dataDir: z.string() }),
});

const answered = <T>(schema: z.ZodType<T>, reply: DoorReply): T => {
  if ("reason" in reply) {
    throw new Error(`refused: ${reply.reason}`);
  }
  return schema.parse(reply.answer);
};

describe("the launch", () => {
  it("answers the data dir the server boots on, under the checkout's own instance", async () => {
    const context = scratch();
    const launch = answered(launchAnswer, await answerDoor(context, "launch"));
    expect(launch).toMatchObject({ env: {}, notes: [] });
    const devRoot = path.join(context.homeDir, DEV_DATA_ROOT_DIR);
    expect(launch.target.dataDir.startsWith(devRoot)).toBe(true);
  });

  it("is the first launch until a server has opened the data dir's thread log", async () => {
    const context = scratch();
    const first = answered(launchAnswer, await answerDoor(context, "launch"));
    expect(first.firstLaunch).toBe(true);

    const resolved = resolveServerTarget(doorTargetArgs(context));
    if (resolved.kind !== "resolved") {
      throw new Error(resolved.error);
    }
    mkdirSync(resolved.target.dataDir, { recursive: true });
    writeFileSync(resolved.target.databasePath, "");
    const next = answered(launchAnswer, await answerDoor(context, "launch"));
    expect(next.firstLaunch).toBe(false);
  });

  it("answers a launch the app's own config refuses with the refusal", async () => {
    expect(await answerDoor(scratch({ INTELIGIR_PORT: "65536" }), "launch")).toEqual({
      reason: "INTELIGIR_PORT must be a valid TCP port",
    });
  });
});

it("refuses a question it has no answer for, as a fault", async () => {
  await expect(answerDoor(scratch(), "restart")).rejects.toThrow(/answers no "restart"/u);
  await expect(answerDoor(scratch(), "facts")).rejects.toThrow(/answers no "facts"/u);
});
