import { readFile } from "node:fs/promises";
import path from "node:path";
import { annotationsResponseSchema } from "@repo/contract/local/annotations/annotations-schema";
import type { AnnotationsResponse } from "@repo/contract/local/annotations/annotations-schema";
import { agentShellCli } from "../harness/agent-shell-cli";
import type { AgentShellCli } from "../harness/agent-shell-cli";
import { expect, expectEq } from "../harness/assert";
import { describeExecError } from "../harness/exec";
import type { Scenario } from "../harness/scenario";

const ESSAY = "notes/Essay.md";
const BODY =
  "# Essay\n\nFile over app is a philosophy: files last, apps do not.\n\nA **bold claim** worth checking.\n";

const markersAround = (id: string, passage: string): string =>
  `%%i:${id}:start%%${passage}%%i:${id}:end%%`;

const stdoutOf = async (cli: AgentShellCli, ...argv: string[]): Promise<string> => {
  const run = await cli(...argv);
  return run.stdout.trim();
};

const annotationsOf = async (cli: AgentShellCli, ...argv: string[]): Promise<AnnotationsResponse> =>
  annotationsResponseSchema.parse(JSON.parse(await stdoutOf(cli, ...argv, "--json")));

// the refusal's own words, or null when the call succeeded
const refusalOf = async (cli: AgentShellCli, ...argv: string[]): Promise<string | null> => {
  try {
    await cli(...argv);
    return null;
  } catch (error) {
    return describeExecError(error);
  }
};

export const annotationsCli: Scenario = {
  description:
    "annotation add puts the markers around the quote in the file; list, edit and reply; remove strips the markers",
  name: "annotations-cli",
  async run(ctx) {
    const app = await ctx.boot({ name: "solo" });
    const cli = agentShellCli(ctx.repoRoot, app.dataDir);
    const onDisk = async (): Promise<string> =>
      await readFile(path.join(app.vaultDir, ESSAY), "utf-8");
    await cli("vault", "write", ESSAY, "--content", BODY, "--if-absent");

    ctx.log("a highlight with a note puts its markers around the passage, and only them");
    const added = await annotationsOf(
      cli,
      "annotation",
      "add",
      ESSAY,
      "a philosophy",
      "--note",
      "Worth it",
    );
    const [root] = added.annotations;
    const id = root?.id ?? "";
    expectEq(root?.state, "anchored", "the highlight's state");
    expectEq(root?.passage, "a philosophy", "the passage it reads");
    expectEq(root?.root.text, "Worth it", "its note");
    const marked = await onDisk();
    expect(
      marked.includes(`is ${markersAround(id, "a philosophy")}: files last`),
      `the markers wrap the passage:\n${marked}`,
    );
    expectEq(
      marked.replaceAll(/%%i:[^%]+:(?:start|end)%%/gu, "").replace(/^---\n[\s\S]*?\n---\n/u, ""),
      BODY,
      "stripping the markers and the minted id gives back the body",
    );

    ctx.log("a passage inside emphasis widens to the whole construct");
    const bold = await annotationsOf(cli, "annotation", "add", ESSAY, "bold claim");
    const boldId = bold.annotations.find((entry) => entry.quote === "bold claim")?.id ?? "";
    const withBold = await onDisk();
    expect(
      withBold.includes(`A ${markersAround(boldId, "**bold claim**")} worth`),
      `the bold passage's markers sit outside its delimiters:\n${withBold}`,
    );

    ctx.log("reply, edit, and list them");
    expectEq(
      await stdoutOf(cli, "annotation", "reply", ESSAY, id, "Agreed"),
      `Replied to ${id}`,
      "the reply",
    );
    expectEq(
      await stdoutOf(cli, "annotation", "edit", ESSAY, id, "Worth a read"),
      `Updated ${id}`,
      "the edit",
    );
    const listed = await annotationsOf(cli, "annotation", "list", ESSAY);
    const edited = listed.annotations.find((entry) => entry.id === id);
    expectEq(edited?.root.text, "Worth a read", "the edited note");
    expectEq(
      edited?.replies.map((reply) => reply.entry.text).join(","),
      "Agreed",
      "the reply under it",
    );
    const human = await stdoutOf(cli, "annotation", "list", ESSAY);
    const lines = human.split("\n");
    expect(
      lines.includes(`${id}\tanchored\t"a philosophy"\tWorth a read`),
      `the human listing names the highlight:\n${lines.join("\n")}`,
    );

    ctx.log("remove strips its markers and leaves the other highlight's");
    expectEq(
      await stdoutOf(cli, "annotation", "remove", ESSAY, id),
      `Removed highlight ${id}`,
      "the removal",
    );
    const stripped = await onDisk();
    expect(!stripped.includes(id), `the removed highlight's markers are gone:\n${stripped}`);
    expect(stripped.includes("is a philosophy: files last"), "the passage reads as it did");
    expect(stripped.includes(markersAround(boldId, "**bold claim**")), "the other stays marked");
    const remaining = await annotationsOf(cli, "annotation", "list", ESSAY);
    expectEq(
      remaining.annotations.map((entry) => entry.id).join(","),
      boldId,
      "the store holds the other alone",
    );

    ctx.log("a passage the text does not hold is refused, and nothing is written");
    const refusal = await refusalOf(cli, "annotation", "add", ESSAY, "not in it", "--json");
    expect(
      refusal?.includes("That passage isn't in the item's text.") === true,
      `the refusal names why: ${refusal ?? "it succeeded"}`,
    );
    expectEq(await onDisk(), stripped, "the file after the refusal");
  },
};
