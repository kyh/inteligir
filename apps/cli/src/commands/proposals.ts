// `inteligir proposals …` — the review loop, drivable by an agent as well as
// by a person (issue #560).
//
// An agent reaching for these is usually the one that MADE the suggestion, so
// the human output leads with what a reader has to decide from: the file, how
// many hunks, and whether the base still matches disk. `show` prints a unified
// diff because that is the format every model and every reviewer already
// reads; nothing here invents a second one.
//
// Every verb names the revision it acts on. The CLI reads it from the row it
// just fetched rather than taking it as an argument — a caller typing a number
// it did not read is exactly the stale-index case the guard exists to refuse,
// and there is no honest way for a person to supply one.

import type { Proposal } from "@repo/server-contract/proposals";
import type { Command } from "commander";
import { CliExitError } from "../cli-error";
import { apiFor, type CliDeps } from "../context";
import { outputJson, requireOk, type JsonOutputOptions } from "../output";

interface ListOptions extends JsonOutputOptions {
  doc?: string;
  thread?: string;
  all?: boolean;
}

interface VerbOptions extends JsonOutputOptions {
  hunk?: string;
}

function summaryLine(proposal: Proposal): string {
  const shape =
    proposal.proposedContent === null
      ? "delete"
      : proposal.baseHash === null
        ? "create"
        : `${proposal.hunks.length} hunk(s)`;
  return `${proposal.id}  ${proposal.status}  ${proposal.docPath}  ${shape}`;
}

/** A unified-diff body for the whole proposal — the hunks the host derived,
 *  in the format `diff` prints them, with each hunk's INDEX in its header so
 *  `--hunk` names something the reader can see. */
function unifiedDiff(proposal: Proposal): string[] {
  if (proposal.proposedContent === null) {
    return [`(this suggestion deletes ${proposal.docPath})`];
  }
  const lines: string[] = [`--- a/${proposal.docPath}`, `+++ b/${proposal.docPath}`];
  for (const hunk of proposal.hunks) {
    lines.push(
      `@@ hunk ${hunk.index} -${hunk.baseStart + 1},${hunk.baseLines.length} ` +
        `+${hunk.baseStart + 1},${hunk.proposedLines.length} @@`,
    );
    for (const line of hunk.baseLines) {
      lines.push(`-${line}`);
    }
    for (const line of hunk.proposedLines) {
      lines.push(`+${line}`);
    }
  }
  return lines;
}

function parseHunkIndex(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const value = Number(raw);
  if (String(value) !== raw.trim() || !Number.isInteger(value) || value < 0) {
    throw new CliExitError(`--hunk must be a hunk index (0 or greater), got "${raw}"`, {
      code: "invalid_request",
    });
  }
  return value;
}

export function registerProposalCommands(program: Command, deps: CliDeps): void {
  const proposals = program
    .command("proposals")
    .description("Suggested edits a review-mode delegation left for you");

  proposals
    .command("list")
    .description("Suggestions awaiting review")
    .option("--doc <path>", "Only suggestions against this vault file")
    .option("--thread <id>", "Only suggestions from this thread")
    .option("--all", "Include resolved suggestions, not just the queue")
    .option("--json", "Print machine-readable JSON output")
    .action(async (opts: ListOptions) => {
      const api = await apiFor(deps);
      const listing = await requireOk(
        await api.proposals.list.$get({
          query: {
            ...(opts.doc === undefined ? {} : { docPath: opts.doc }),
            ...(opts.thread === undefined ? {} : { threadId: opts.thread }),
            ...(opts.all === true ? { includeResolved: "true" as const } : {}),
          },
        }),
      );
      const body = await listing.json();
      if (outputJson(opts, body)) {
        return;
      }
      for (const proposal of body.proposals) {
        console.log(summaryLine(proposal));
      }
    });

  proposals
    .command("show <id>")
    .description("One suggestion as a unified diff")
    .option("--json", "Print machine-readable JSON output")
    .action(async (id: string, opts: JsonOutputOptions) => {
      const api = await apiFor(deps);
      const fetched = await requireOk(await api.proposals.get.$get({ query: { proposalId: id } }));
      const body = await fetched.json();
      if (outputJson(opts, body)) {
        return;
      }
      console.log(summaryLine(body.proposal));
      if (body.proposal.status === "stale") {
        console.log("(stale — the file changed after this was written, so it cannot be applied)");
      }
      for (const line of unifiedDiff(body.proposal)) {
        console.log(line);
      }
    });

  proposals
    .command("accept <id>")
    .description("Apply a suggestion (or one hunk of it) through the vault's guarded write")
    .option("--hunk <index>", "Apply only this hunk; omitted applies the whole suggestion")
    .option("--json", "Print machine-readable JSON output")
    .action(async (id: string, opts: VerbOptions) => {
      await runVerb(deps, "accept", id, opts);
    });

  proposals
    .command("reject <id>")
    .description("Discard a suggestion (or one hunk of it); no file is touched")
    .option("--hunk <index>", "Discard only this hunk; omitted discards the whole suggestion")
    .option("--json", "Print machine-readable JSON output")
    .action(async (id: string, opts: VerbOptions) => {
      await runVerb(deps, "reject", id, opts);
    });
}

async function runVerb(
  deps: CliDeps,
  verb: "accept" | "reject",
  id: string,
  opts: VerbOptions,
): Promise<void> {
  const hunkIndex = parseHunkIndex(opts.hunk);
  const api = await apiFor(deps);
  // Read first, for the revision: the host refuses a verb naming a pair it no
  // longer holds, and this read is what makes the number honest.
  const fetched = await requireOk(await api.proposals.get.$get({ query: { proposalId: id } }));
  const { proposal } = await fetched.json();
  const json = {
    proposalId: id,
    expectedRevision: proposal.revision,
    ...(hunkIndex === undefined ? {} : { hunkIndex }),
  };
  const answered = await requireOk(
    verb === "accept"
      ? await api.proposals.accept.$post({ json })
      : await api.proposals.reject.$post({ json }),
  );
  const body = await answered.json();
  if (outputJson(opts, body)) {
    return;
  }
  const remaining = body.proposal.hunks.length;
  console.log(
    body.proposal.status === "pending"
      ? `${body.proposal.id} still pending — ${remaining} hunk(s) left to review`
      : `${body.proposal.id} ${body.proposal.status}`,
  );
}
