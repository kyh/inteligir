// an agent's save of a picture, end to end: the scripted driver's `save <path>` line (S3) runs the
// items service's file save (S2's wrapper and original), the turn's commit carries the note, the
// wrapper and the PNG byte for byte, the asset route serves the PNG, and `action undo` takes all
// three back through the binary undo, leaving nothing on disk, in the index or in the tree.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { knowledgeItemsResponseSchema } from "@repo/contract/local/knowledge/knowledge-schema";
import { vaultAssetUrl } from "@repo/contract/local/routes";
import { authorizationHeader, readServerFile } from "inteligir/server/server-file";
import { z } from "zod";
import { agentShellCli } from "../harness/agent-shell-cli";
import type { AgentShellCli } from "../harness/agent-shell-cli";
import { expect, expectEq } from "../harness/assert";
import { gitIn } from "../harness/exec";
import type { AppInstance } from "../harness/instance";
import { solidPng } from "../harness/png-pixels";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";

const PICTURE_NAME = "harbour-at-dusk.png";
const WRAPPER = "Unsorted/harbour-at-dusk.md";
const ORIGINAL = `assets/${PICTURE_NAME}`;
const PICTURE = solidPng(48, 32, [200, 90, 40, 255]);
const DEADLINE_MS = 30_000;

// loose: only the fields asserted on, so an addition upstream does not fail the run
const threadOutputSchema = z.looseObject({ thread: z.looseObject({ id: z.string() }) });
const turnChangesOutputSchema = z.looseObject({
  turns: z.array(
    z.looseObject({ paths: z.array(z.string()), state: z.string(), turnId: z.string() }),
  ),
});
const undoOutputSchema = z.looseObject({
  kept: z.array(z.unknown()),
  reverted: z.array(z.string()),
});

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const sorted = (paths: readonly string[]): string => paths.toSorted().join(",");

const jsonOf = async <T>(cli: AgentShellCli, schema: z.ZodType<T>, ...argv: string[]) => {
  const { stdout } = await cli(...argv, "--json");
  return schema.parse(JSON.parse(stdout));
};

// the asset route as the window asks it, with the bearer in place of the window's cookie
const servedPicture = async (app: AppInstance): Promise<Response> => {
  const server = readServerFile(app.dataDir);
  expect(server !== null, `no server.json in ${app.dataDir}`);
  const { mediaToken } = await app.api.system.status();
  return await fetch(vaultAssetUrl(app.baseUrl, ORIGINAL, mediaToken), {
    headers: { authorization: authorizationHeader(server.token) },
  });
};

const imageItems = async (cli: AgentShellCli): Promise<string[]> => {
  const { items } = await jsonOf(cli, knowledgeItemsResponseSchema, "items", "--kind", "image");
  return items.map((item) => item.path);
};

export const agentSaveIntegrated: Scenario = {
  description:
    "a scripted turn's save of a PNG lands the wrapper and the PNG in its commit, and its undo takes both back byte-exact",
  name: "agent-save-integrated",
  async run(ctx) {
    const app = await ctx.boot({ extraEnv: { INTELIGIR_AGENT: "scripted" }, name: "solo" });
    const cli = agentShellCli(ctx.repoRoot, app.dataDir);
    const sources = path.join(ctx.scratchDir, "sources");
    await mkdir(sources, { recursive: true });
    const picture = path.join(sources, PICTURE_NAME);
    await writeFile(picture, PICTURE);
    const pictureBlob = await gitIn(app.vaultDir, ["hash-object", picture]);

    ctx.log("a turn whose text says `save <the picture>` saves it inside the turn");
    const { thread } = await jsonOf(cli, threadOutputSchema, "action", "new", `save ${picture}`);
    // exec throws on a non-zero exit, so a clean return is the settle
    await cli("action", "wait", thread.id, "--timeout", "60");
    const note = `Agent/${thread.id}.md`;
    const { turns } = await jsonOf(cli, turnChangesOutputSchema, "action", "changes", thread.id);
    expectEq(turns.length, 1, "the turns that changed the library");
    const [turn] = turns;
    expectEq(turn?.state, "applied", "the turn's state");
    expectEq(sorted(turn?.paths ?? []), sorted([note, WRAPPER, ORIGINAL]), "the turn's paths");

    ctx.log("the wrapper is an image item embedding its original, which is the PNG byte for byte");
    const wrapper = await readFile(path.join(app.vaultDir, WRAPPER), "utf-8");
    expect(
      wrapper.includes("\nkind: image\n") && wrapper.includes(`![](${ORIGINAL})`),
      `the wrapper is not an image item embedding ${ORIGINAL}:\n${wrapper}`,
    );
    expectEq(
      sha256(new Uint8Array(await readFile(path.join(app.vaultDir, ORIGINAL)))),
      sha256(PICTURE),
      "the original on disk against the picture saved",
    );
    await pollUntil(
      async () => await imageItems(cli),
      (paths) => paths.includes(WRAPPER),
      {
        deadlineMs: DEADLINE_MS,
        describe: (paths) => `the library's images never listed ${WRAPPER}: ${paths.join(", ")}`,
      },
    );
    const served = await servedPicture(app);
    expectEq(served.status, 200, "the asset route's answer for the original");
    expectEq(served.headers.get("content-type"), "image/png", "the original's served type");
    expectEq(
      sha256(new Uint8Array(await served.arrayBuffer())),
      sha256(PICTURE),
      "the served bytes against the picture saved",
    );

    ctx.log("one commit carries the turn, and it holds the note, the wrapper and the PNG's blob");
    const log = await gitIn(app.vaultDir, [
      "log",
      "--format=%H",
      "--fixed-strings",
      `--grep=${turn?.turnId ?? "no turn"}`,
    ]);
    const shas = log.split("\n").filter((line) => line !== "");
    expectEq(shas.length, 1, "the commits carrying the turn");
    const [sha = "HEAD"] = shas;
    const committed = await gitIn(app.vaultDir, ["show", "--name-only", "--format=", sha]);
    expectEq(
      sorted(committed.split("\n").filter((line) => line !== "")),
      sorted([note, WRAPPER, ORIGINAL]),
      "the turn's commit",
    );
    expectEq(
      await gitIn(app.vaultDir, ["rev-parse", `${sha}:${ORIGINAL}`]),
      pictureBlob,
      "the PNG the commit holds against the picture saved",
    );

    ctx.log("undo takes the note, the wrapper and the PNG back, and nothing of them is left");
    const undone = await jsonOf(cli, undoOutputSchema, "action", "undo", thread.id);
    expectEq(sorted(undone.reverted), sorted([note, WRAPPER, ORIGINAL]), "what the undo reverted");
    expectEq(undone.kept.length, 0, "what the undo kept");
    for (const gone of [note, WRAPPER, ORIGINAL]) {
      expect(!existsSync(path.join(app.vaultDir, gone)), `${gone} is still on disk after the undo`);
    }
    const servedAfter = await servedPicture(app);
    expectEq(servedAfter.status, 404, "the asset route once the PNG is gone");
    await pollUntil(
      async () => await imageItems(cli),
      (paths) => !paths.includes(WRAPPER),
      {
        deadlineMs: DEADLINE_MS,
        describe: (paths) => `the library still lists ${WRAPPER}: ${paths.join(", ")}`,
      },
    );
    await app.api.vault.commitNow();
    const tracked = await gitIn(app.vaultDir, ["ls-files", "--", note, WRAPPER, ORIGINAL]);
    expectEq(tracked, "", "the undone paths the tree still tracks");
    const { turns: after } = await jsonOf(
      cli,
      turnChangesOutputSchema,
      "action",
      "changes",
      thread.id,
    );
    expectEq(after[0]?.state, "undone", "the turn's state after its undo");
  },
};
