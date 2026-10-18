import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { LocalClient } from "@repo/contract/local";
import type { TimelineRow } from "@repo/contract/local/thread-timeline";
import { agentShellCli } from "../harness/agent-shell-cli";
import type { AgentShellCli } from "../harness/agent-shell-cli";
import { expect, expectEq } from "../harness/assert";
import { gitIn, readOrNull } from "../harness/exec";
import type { Scenario } from "../harness/scenario";

// the preset block's first sentence, which the scripted echo carries since it echoes the prompt
const TIDY_OPENING =
  "Tidy the person's library: file and tag the items in Unsorted/ and the items with no tags.";
const TIDY_LABEL = "Tidy my library";

const DIAGRAM =
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16"><rect width="32" height="16" fill="#2a6"/></svg>\n';

// loose: only the fields asserted on, so an addition upstream does not fail the run.
const threadOutputSchema = z.looseObject({ thread: z.looseObject({ id: z.string() }) });
const turnChangesOutputSchema = z.looseObject({
  turns: z.array(
    z.looseObject({ paths: z.array(z.string()), state: z.string(), turnId: z.string() }),
  ),
});
const undoOutputSchema = z.looseObject({ reverted: z.array(z.string()) });

const startAction = async (cli: AgentShellCli, ...argv: string[]): Promise<string> => {
  const created = await cli("action", "new", ...argv, "--json");
  const { thread } = threadOutputSchema.parse(JSON.parse(created.stdout));
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

export const tidyLibraryScripted: Scenario = {
  description:
    "action new --preset tidy-library stores Tidy my library as the text and the scripted echo carries the preset block; a scripted save of an SVG lands in its turn's commit and its undo takes both files back",
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

    ctx.log("a scripted turn saves a picture: the wrapper and its original join the turn");
    const sources = path.join(ctx.scratchDir, "sources");
    await mkdir(sources, { recursive: true });
    const diagram = path.join(sources, "diagram.svg");
    await writeFile(diagram, DIAGRAM, "utf-8");
    const saver = await startAction(cli, `save ${diagram}`);
    const notePath = `Agent/${saver}.md`;
    const wrapper = "Unsorted/diagram.md";
    const original = "assets/diagram.svg";
    const changes = await cli("action", "changes", saver, "--json");
    const { turns } = turnChangesOutputSchema.parse(JSON.parse(changes.stdout));
    const [turn] = turns;
    expectEq(turns.length, 1, "the turns that changed the library");
    expectEq(turn?.state, "applied", "the turn's state");
    expectEq(sorted(turn?.paths ?? []), sorted([notePath, wrapper, original]), "its paths");
    expectEq(await readOrNull(path.join(app.vaultDir, original)), DIAGRAM, "the original");
    const wrapperBytes = (await readOrNull(path.join(app.vaultDir, wrapper))) ?? "";
    expect(
      wrapperBytes.includes("kind: image") && wrapperBytes.includes(`![](${original})`),
      `the wrapper is an image item embedding its original:\n${wrapperBytes}`,
    );
    const commits = await gitIn(app.vaultDir, [
      "log",
      "--format=%H",
      "--fixed-strings",
      `--grep=${turn?.turnId ?? "no turn"}`,
    ]);
    const shas = commits.split("\n").filter((line) => line !== "");
    expectEq(shas.length, 1, "the commits carrying the turn");
    const committed = await gitIn(app.vaultDir, [
      "show",
      "--name-only",
      "--format=",
      shas[0] ?? "HEAD",
    ]);
    expectEq(
      sorted(committed.split("\n").filter((line) => line !== "")),
      sorted([notePath, wrapper, original]),
      "the turn's commit holds the note, the wrapper and the original",
    );

    ctx.log("undo takes the note, the wrapper and the original back");
    const undone = await cli("action", "undo", saver, "--json");
    const { reverted } = undoOutputSchema.parse(JSON.parse(undone.stdout));
    expectEq(sorted(reverted), sorted([notePath, wrapper, original]), "what the undo reverted");
    for (const gone of [notePath, wrapper, original]) {
      expectEq(await readOrNull(path.join(app.vaultDir, gone)), null, `${gone} after the undo`);
    }
  },
};
