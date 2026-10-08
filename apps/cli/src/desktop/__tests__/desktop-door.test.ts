import path from "node:path";
import { DEV_DATA_ROOT_DIR } from "inteligir/server/config";
import { pathContains } from "inteligir/server/path-containment";
import { makeTempDir } from "inteligir/server/testing";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { answerDoor } from "../desktop-door";
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
    expect(pathContains(path.join(context.homeDir, DEV_DATA_ROOT_DIR), launch.target.dataDir)).toBe(
      true,
    );
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
