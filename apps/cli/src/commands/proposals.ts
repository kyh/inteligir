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

import type {
  AcceptProposalRequest,
  ListProposalsQueryInput,
  Proposal,
} from "@repo/server-contract/proposals";
import { defineCommand } from "citty";
import { CliExitError } from "../cli-error";
import { apiFor, type CliDeps } from "../context";
import { jsonArg, out, outputJson, requireOk, writeLines, type JsonOutputOptions } from "../output";

interface VerbOptions extends JsonOutputOptions {
  hunk?: string | undefined;
}

function summaryLine(proposal: Proposal): string {
  const change =
    proposal.proposedContent === null
      ? "delete"
      : proposal.baseHash === null
        ? "create"
        : `${proposal.hunks.length} hunk(s)`;
  return `${proposal.id}  ${proposal.status}  ${proposal.docPath}  ${change}`;
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
  const json: AcceptProposalRequest = {
    proposalId: id,
    expectedRevision: proposal.revision,
  };
  if (hunkIndex !== undefined) {
    json.hunkIndex = hunkIndex;
  }
  const answered = await requireOk(
    verb === "accept"
      ? await api.proposals.accept.$post({ json })
      : await api.proposals.reject.$post({ json }),
  );
  const body = await answered.json();
  if (outputJson(opts, body)) {
    return;
  }
  if (body.proposal.status === "pending") {
    out.info(
      `${body.proposal.id} still pending — ${body.proposal.hunks.length} hunk(s) left to review`,
    );
    return;
  }
  out.success(`${body.proposal.id} ${body.proposal.status}`);
}

export function proposalsCommand(deps: CliDeps) {
  return defineCommand({
    meta: {
      name: "proposals",
      description: "Suggested edits a review-mode delegation left for you",
    },
    subCommands: {
      list: defineCommand({
        meta: { name: "list", description: "Suggestions awaiting review" },
        args: {
          doc: { type: "string", description: "Only suggestions against this vault file" },
          thread: { type: "string", description: "Only suggestions from this thread" },
          all: { type: "boolean", description: "Include resolved suggestions, not just the queue" },
          ...jsonArg,
        },
        run: async ({ args }) => {
          const api = await apiFor(deps);
          const query: ListProposalsQueryInput = {};
          if (args.doc !== undefined) {
            query.docPath = args.doc;
          }
          if (args.thread !== undefined) {
            query.threadId = args.thread;
          }
          if (args.all === true) {
            query.includeResolved = "true";
          }
          const listing = await requireOk(await api.proposals.list.$get({ query }));
          const body = await listing.json();
          if (outputJson(args, body)) {
            return;
          }
          writeLines(body.proposals.map(summaryLine));
        },
      }),

      show: defineCommand({
        meta: { name: "show", description: "One suggestion as a unified diff" },
        args: {
          id: { type: "positional", required: true, description: "The suggestion id" },
          ...jsonArg,
        },
        run: async ({ args }) => {
          const api = await apiFor(deps);
          const fetched = await requireOk(
            await api.proposals.get.$get({ query: { proposalId: args.id } }),
          );
          const body = await fetched.json();
          if (outputJson(args, body)) {
            return;
          }
          writeLines([summaryLine(body.proposal)]);
          if (body.proposal.status === "stale") {
            out.info("(stale — the file changed after this was written, so it cannot be applied)");
          }
          writeLines(unifiedDiff(body.proposal));
        },
      }),

      accept: defineCommand({
        meta: {
          name: "accept",
          description: "Apply a suggestion (or one hunk of it) through the vault's guarded write",
        },
        args: {
          id: { type: "positional", required: true, description: "The suggestion id" },
          hunk: {
            type: "string",
            description: "Apply only this hunk; omitted applies the whole suggestion",
          },
          ...jsonArg,
        },
        run: async ({ args }) => {
          await runVerb(deps, "accept", args.id, args);
        },
      }),

      reject: defineCommand({
        meta: {
          name: "reject",
          description: "Discard a suggestion (or one hunk of it); no file is touched",
        },
        args: {
          id: { type: "positional", required: true, description: "The suggestion id" },
          hunk: {
            type: "string",
            description: "Discard only this hunk; omitted discards the whole suggestion",
          },
          ...jsonArg,
        },
        run: async ({ args }) => {
          await runVerb(deps, "reject", args.id, args);
        },
      }),
    },
  });
}
