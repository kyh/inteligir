import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { LocalClient } from "@repo/contract/local";
import { knowledgeItemsResponseSchema } from "@repo/contract/local/knowledge/knowledge-schema";
import { vaultAssetUrl } from "@repo/contract/local/routes";
import type { TimelineRow } from "@repo/contract/local/thread-timeline";
import { authorizationHeader, readServerFile } from "inteligir/server/server-file";
import { agentShellCli } from "../harness/agent-shell-cli";
import type { AgentShellCli } from "../harness/agent-shell-cli";
import { expect, expectEq } from "../harness/assert";
import { gitIn, readOrNull } from "../harness/exec";
import type { AppInstance } from "../harness/instance";
import { solidPng } from "../harness/png-pixels";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";

// the preset block's first sentence, which the scripted echo carries since it echoes the prompt
const TIDY_OPENING =
  "Tidy the person's library: file and tag the items in Unsorted/ and the items with no tags.";
const TIDY_LABEL = "Tidy my library";

const DIAGRAM =
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16"><rect width="32" height="16" fill="#2a6"/></svg>\n';
const DIAGRAM_WRAPPER = "Unsorted/diagram.md";
const DIAGRAM_ORIGINAL = "assets/diagram.svg";
// a binary picture beside the text one, so a byte the save path decoded as text would show
const PICTURE = solidPng(48, 32, [200, 90, 40, 255]);
const PICTURE_WRAPPER = "Unsorted/harbour-at-dusk.md";
const PICTURE_ORIGINAL = "assets/harbour-at-dusk.png";
const LISTING_DEADLINE_MS = 30_000;

// loose: only the fields asserted on, so an addition upstream does not fail the run.
const threadOutputSchema = z.looseObject({ thread: z.looseObject({ id: z.string() }) });
const turnChangesOutputSchema = z.looseObject({
  turns: z.array(
    z.looseObject({
      items: z.array(z.string()),
      paths: z.array(z.string()),
      state: z.string(),
      turnId: z.string(),
    }),
  ),
});
const undoOutputSchema = z.looseObject({
  kept: z.array(z.unknown()),
  reverted: z.array(z.string()),
});

const jsonOf = async <T>(cli: AgentShellCli, schema: z.ZodType<T>, ...argv: string[]) => {
  const { stdout } = await cli(...argv, "--json");
  return schema.parse(JSON.parse(stdout));
};

const startAction = async (cli: AgentShellCli, ...argv: string[]): Promise<string> => {
  const { thread } = await jsonOf(cli, threadOutputSchema, "action", "new", ...argv);
  // exec throws on a non-zero exit, so a clean return is the settle
  await cli("action", "wait", thread.id, "--timeout", "60");
  return thread.id;
};

const conversationText = async (
  api: LocalClient,
  threadId: string,
  role: "user" | "assistant",
): Promise<string> => {
  const body = await api.threads.timeline({ threadId });
  expect(body.kind === "full", `the timeline answered "${body.kind}"`);
  const row = body.timeline.rows.find(
    (candidate: TimelineRow) => candidate.kind === "conversation" && candidate.role === role,
  );
  return row?.kind === "conversation" ? row.text : "";
};

const sorted = (paths: readonly string[]): string => paths.toSorted().join(",");

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

// the asset route as the window asks it, with the bearer in place of the window's cookie
const servedPicture = async (app: AppInstance): Promise<Response> => {
  const server = readServerFile(app.dataDir);
  expect(server !== null, `no server.json in ${app.dataDir}`);
  const { mediaToken } = await app.api.system.status();
  return await fetch(vaultAssetUrl(app.baseUrl, PICTURE_ORIGINAL, mediaToken), {
    headers: { authorization: authorizationHeader(server.token) },
  });
};

const imageItems = async (cli: AgentShellCli): Promise<string[]> => {
  const { items } = await jsonOf(cli, knowledgeItemsResponseSchema, "items", "--kind", "image");
  return items.map((item) => item.path);
};

const expectWrapsImage = async (app: AppInstance, wrapper: string, original: string) => {
  const text = (await readOrNull(path.join(app.vaultDir, wrapper))) ?? "";
  expect(
    text.includes("\nkind: image\n") && text.includes(`![](${original})`),
    `${wrapper} is not an image item embedding ${original}:\n${text}`,
  );
};

export const tidyLibraryScripted: Scenario = {
  description:
    "action new --preset tidy-library stores Tidy my library as the text and the scripted echo carries the preset block; a scripted turn's save of an SVG and a PNG lands each wrapper and original in its one commit, the PNG byte for byte on disk, in the commit and on the asset route, the turn counting the note and the two pictures, and its undo takes all five files back off disk, the route, the listing and the tree",
  name: "tidy-library-scripted",
  async run(ctx) {
    const app = await ctx.boot({ extraEnv: { INTELIGIR_AGENT: "scripted" }, name: "solo" });
    const cli = agentShellCli(ctx.repoRoot, app.dataDir);

    ctx.log("Tidy my library: its label is the stored text, its procedure the turn's prompt");
    const tidy = await startAction(cli, "--preset", "tidy-library");
    expectEq(await conversationText(app.api, tidy, "user"), TIDY_LABEL, "the stored text");
    const echo = await conversationText(app.api, tidy, "assistant");
    expect(echo.includes(TIDY_OPENING), `the prompt opens the preset's procedure:\n${echo}`);
    expect(
      echo.includes("`inteligir items --folder Unsorted --limit 100 --json`"),
      "the procedure pages Unsorted by the hundred",
    );
    expect(!echo.includes(`Noted: ${TIDY_LABEL}`), "the label alone is not the prompt");

    ctx.log("a scripted turn saves two pictures: each wrapper and its original join the turn");
    const sources = path.join(ctx.scratchDir, "sources");
    await mkdir(sources, { recursive: true });
    const diagram = path.join(sources, "diagram.svg");
    await writeFile(diagram, DIAGRAM, "utf-8");
    const picture = path.join(sources, path.basename(PICTURE_ORIGINAL));
    await writeFile(picture, PICTURE);
    const pictureBlob = await gitIn(app.vaultDir, ["hash-object", picture]);
    const saver = await startAction(cli, `save ${diagram}\nsave ${picture}`);
    const notePath = `Agent/${saver}.md`;
    const written = [
      notePath,
      DIAGRAM_WRAPPER,
      DIAGRAM_ORIGINAL,
      PICTURE_WRAPPER,
      PICTURE_ORIGINAL,
    ];
    const { turns } = await jsonOf(cli, turnChangesOutputSchema, "action", "changes", saver);
    const [turn] = turns;
    expectEq(turns.length, 1, "the turns that changed the library");
    expectEq(turn?.state, "applied", "the turn's state");
    expectEq(sorted(turn?.paths ?? []), sorted(written), "its paths");
    // a person counts the note and the pictures: an original rides the item that embeds it
    expectEq(
      sorted(turn?.items ?? []),
      sorted([notePath, DIAGRAM_WRAPPER, PICTURE_WRAPPER]),
      "the turn's items",
    );

    ctx.log("each wrapper is an image item embedding its original, which is the file saved");
    expectEq(await readOrNull(path.join(app.vaultDir, DIAGRAM_ORIGINAL)), DIAGRAM, "the SVG");
    await expectWrapsImage(app, DIAGRAM_WRAPPER, DIAGRAM_ORIGINAL);
    expectEq(
      sha256(new Uint8Array(await readFile(path.join(app.vaultDir, PICTURE_ORIGINAL)))),
      sha256(PICTURE),
      "the PNG on disk against the picture saved",
    );
    await expectWrapsImage(app, PICTURE_WRAPPER, PICTURE_ORIGINAL);
    await pollUntil(
      async () => await imageItems(cli),
      (paths) => paths.includes(DIAGRAM_WRAPPER) && paths.includes(PICTURE_WRAPPER),
      {
        deadlineMs: LISTING_DEADLINE_MS,
        describe: (paths) => `the library's images never listed both: ${paths.join(", ")}`,
      },
    );
    const served = await servedPicture(app);
    expectEq(served.status, 200, "the asset route's answer for the PNG");
    expectEq(served.headers.get("content-type"), "image/png", "the PNG's served type");
    expectEq(
      sha256(new Uint8Array(await served.arrayBuffer())),
      sha256(PICTURE),
      "the served bytes against the picture saved",
    );

    ctx.log("one commit carries the turn, and it holds every path and the PNG's blob");
    const commits = await gitIn(app.vaultDir, [
      "log",
      "--format=%H",
      "--fixed-strings",
      `--grep=${turn?.turnId ?? "no turn"}`,
    ]);
    const shas = commits.split("\n").filter((line) => line !== "");
    expectEq(shas.length, 1, "the commits carrying the turn");
    const [sha = "HEAD"] = shas;
    const committed = await gitIn(app.vaultDir, ["show", "--name-only", "--format=", sha]);
    expectEq(
      sorted(committed.split("\n").filter((line) => line !== "")),
      sorted(written),
      "the turn's commit holds the note, the wrappers and the originals",
    );
    expectEq(
      await gitIn(app.vaultDir, ["rev-parse", `${sha}:${PICTURE_ORIGINAL}`]),
      pictureBlob,
      "the PNG the commit holds against the picture saved",
    );

    ctx.log("undo takes the note, the wrappers and the originals back, and leaves nothing of them");
    const undone = await jsonOf(cli, undoOutputSchema, "action", "undo", saver);
    expectEq(sorted(undone.reverted), sorted(written), "what the undo reverted");
    expectEq(undone.kept.length, 0, "what the undo kept");
    for (const gone of written) {
      expect(!existsSync(path.join(app.vaultDir, gone)), `${gone} is still on disk after the undo`);
    }
    const servedAfter = await servedPicture(app);
    expectEq(servedAfter.status, 404, "the asset route once the PNG is gone");
    await pollUntil(
      async () => await imageItems(cli),
      (paths) => !paths.includes(DIAGRAM_WRAPPER) && !paths.includes(PICTURE_WRAPPER),
      {
        deadlineMs: LISTING_DEADLINE_MS,
        describe: (paths) => `the library still lists a picture: ${paths.join(", ")}`,
      },
    );
    await app.api.vault.commitNow();
    expectEq(
      await gitIn(app.vaultDir, ["ls-files", "--", ...written]),
      "",
      "the undone paths the tree still tracks",
    );
    const { turns: after } = await jsonOf(cli, turnChangesOutputSchema, "action", "changes", saver);
    expectEq(after[0]?.state, "undone", "the turn's state after its undo");
  },
};
