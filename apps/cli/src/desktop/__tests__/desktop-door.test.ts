import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CONFIG_FILE_NAME, DEV_DATA_ROOT_DIR } from "inteligir/server/config";
import { pathContains } from "inteligir/server/path-containment";
import { makeTempDir } from "inteligir/server/testing";
import { selectionRefusalMessage } from "inteligir/server/vault-switch";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { answerDoor } from "../desktop-door";
import type { DoorContext, DoorReply } from "../desktop-door";
import { switchRefusalMessage } from "../vaults";

// a checkout's launch on a home of its own: no login shell is asked and the host's git runs, so
// the door touches nothing outside the scratch home
const scratch = (env: NodeJS.ProcessEnv = {}): DoorContext => ({
  env,
  homeDir: makeTempDir("inteligir-door-"),
});

// the shapes the shell reads (apps/desktop/src-tauri/src/launch.rs), parsed as it parses them
const targetAnswer = z.strictObject({
  dataDir: z.string(),
  rootDataDir: z.string(),
  switchBlocked: z.string().nullable(),
  vaultDir: z.string(),
});
const launchAnswer = z.strictObject({
  env: z.record(z.string(), z.string()),
  notes: z.array(z.string()),
  plan: z.enum(["boot", "first-run"]),
  proposal: z.strictObject({ name: z.string(), parent: z.string() }),
  target: targetAnswer,
});
const openingAnswer = z.strictObject({ selector: z.string().nullable(), vaultDir: z.string() });

const answered = <T>(schema: z.ZodType<T>, reply: DoorReply): T => {
  if ("reason" in reply) {
    throw new Error(`refused: ${reply.reason}`);
  }
  return schema.parse(reply.answer);
};

const launched = async (context: DoorContext) =>
  answered(launchAnswer, await answerDoor(context, "launch", []));

describe("the launch", () => {
  it("asks first when nothing chose a vault, proposing the one a launch would have made", async () => {
    const context = scratch();
    const launch = await launched(context);
    expect(launch).toMatchObject({ env: {}, notes: [], plan: "first-run" });
    expect(launch.target.switchBlocked).toBeNull();
    expect(pathContains(path.join(context.homeDir, DEV_DATA_ROOT_DIR), launch.target.dataDir)).toBe(
      true,
    );
    expect(path.join(launch.proposal.parent, launch.proposal.name)).toBe(launch.target.vaultDir);
  });

  it("boots a pinned vault, and says a switch is not the app's to make", async () => {
    const vaultDir = makeTempDir("inteligir-door-vault-");
    const launch = await launched(scratch({ INTELIGIR_VAULT_DIR: vaultDir }));
    expect(launch.plan).toBe("boot");
    expect(launch.target).toMatchObject({
      switchBlocked: selectionRefusalMessage("vault-pinned-by-env"),
      vaultDir,
    });
  });

  it("answers a launch the app's own config refuses with the refusal", async () => {
    expect(await answerDoor(scratch({ INTELIGIR_PORT: "65536" }), "launch", [])).toEqual({
      reason: "INTELIGIR_PORT must be a valid TCP port",
    });
  });
});

describe("the selector", () => {
  it("points the next launch at a created vault, and is taken back out", async () => {
    const context = scratch();
    const work = path.join(context.homeDir, "Work");
    const planned = answered(
      openingAnswer,
      await answerDoor(context, "plan-create", [context.homeDir, " Work "]),
    );
    expect(planned).toEqual({ selector: work, vaultDir: work });
    const selected = answered(targetAnswer, await answerDoor(context, "select", [work]));
    expect(selected.vaultDir).toBe(work);
    const launch = await launched(context);
    expect(launch).toMatchObject({ plan: "boot", target: { vaultDir: work } });
    const cleared = answered(targetAnswer, await answerDoor(context, "select", ["--default"]));
    expect(cleared.vaultDir).not.toBe(work);
    const config: unknown = JSON.parse(
      readFileSync(path.join(launch.target.rootDataDir, CONFIG_FILE_NAME), "utf-8"),
    );
    expect(config).not.toHaveProperty("vaultDir");
  });

  it("takes back a selection the boot then refuses, so a refusal never moves it", async () => {
    const context = scratch();
    const work = path.join(context.homeDir, "Work");
    answered(targetAnswer, await answerDoor(context, "select", [work]));
    const before = await launched(context);
    // inside the data dir: the boot refuses it, but only once the selector names it
    const refused = await answerDoor(context, "select", [
      path.join(before.target.rootDataDir, "notes"),
    ]);
    expect("reason" in refused).toBe(true);
    const after = await launched(context);
    expect(after.target.vaultDir).toBe(work);
  });

  it("opens a folder that is there where it is, by its own spelling", async () => {
    const context = scratch();
    const notes = path.join(context.homeDir, "Notes");
    mkdirSync(notes);
    // a selection keeps the folder's physical spelling, which macOS's tmpdir, behind a symlink
    // (/tmp is /private/tmp), shows
    const physical = realpathSync.native(notes);
    expect(answered(openingAnswer, await answerDoor(context, "plan-open", [notes]))).toEqual({
      selector: physical,
      vaultDir: physical,
    });
  });
});

describe("a switch", () => {
  it("is refused in the person's words before anything moves", async () => {
    const context = scratch();
    expect(await answerDoor(context, "plan-switch", [path.join(context.homeDir, "Gone")])).toEqual({
      reason: switchRefusalMessage("not-a-directory"),
    });
  });

  it("answers the folder a boot would open", async () => {
    const context = scratch();
    const other = path.join(context.homeDir, "Other");
    mkdirSync(other);
    const physical = realpathSync.native(other);
    expect(answered(openingAnswer, await answerDoor(context, "plan-switch", [other]))).toEqual({
      selector: physical,
      vaultDir: physical,
    });
  });
});

describe("a picked folder", () => {
  it("counts its notes and names no sync of its own", async () => {
    const context = scratch();
    const folder = path.join(context.homeDir, "Plain");
    mkdirSync(folder);
    writeFileSync(path.join(folder, "a.md"), "# a\n");
    writeFileSync(path.join(folder, "b.md"), "# b\n");
    const reply = await answerDoor(context, "facts", [folder]);
    expect(reply).toEqual({
      answer: { externalSync: null, noteCount: { capped: false, count: 2 }, ownSync: null },
    });
  });

  it("says where another service already syncs it, and what to warn", async () => {
    const context = scratch();
    const inDropbox = path.join(context.homeDir, "Library", "CloudStorage", "Dropbox", "Notes");
    mkdirSync(inDropbox, { recursive: true });
    const reply = await answerDoor(context, "sync", [inDropbox]);
    expect(reply).toMatchObject({
      answer: { externalSync: { kind: "dropbox" }, warning: { headline: expect.any(String) } },
    });
    expect(await answerDoor(context, "sync", [context.homeDir])).toEqual({
      answer: { externalSync: null, warning: null },
    });
  });
});

it("refuses a question it has no answer for, as a fault", async () => {
  await expect(answerDoor(scratch(), "restart", [])).rejects.toThrow(/answers no "restart"/u);
  await expect(answerDoor(scratch(), "facts", [])).rejects.toThrow(/needs a folder/u);
});
