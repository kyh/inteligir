// TypeScript catches a missing arm, not a drifted one: a state added to one table and forgotten in
// another typechecks. a file naming every member as a quoted literal holds a total table; one built
// by iterating the array is invisible here and cannot drift. no subset rule: a derived `as const`
// subset spells literals too, and UI leaves collide on common words ("idle", "error").

import { pendingInteractionStatusValues } from "@repo/domain/pending-interaction-status";
import { threadStatusValues } from "@repo/domain/thread-status";
import { describe, expect, it } from "vitest";
import { sourceOf, workspaceFiles, workspaces } from "./repo";

// below this, naming every member is a coincidence rather than a table: one literal is a use, not
// a dispatch, so a one-member vocabulary (DOC_CHANGE_KINDS) has no row here — the guard cannot
// tell its producer from its table.
const TOTALITY_FLOOR = 2;

interface Vocabulary {
  name: string;
  members: readonly string[];
  declaredIn: string;
  dispatchedIn: Record<string, string>;
}

const VOCABULARIES: Vocabulary[] = [
  {
    declaredIn: "packages/domain/src/thread-status.ts",
    dispatchedIn: {
      "apps/cli/src/server/threads/thread-send.ts":
        "server POLICY — what a send does in each status (start, queue, refuse), which is a different question from what the status is called",
      "apps/cli/src/server/threads/thread-stop.ts":
        "server POLICY — what a stop does in each status (answer that nothing runs, or interrupt the turn unless another device runs it), a different question from what a send does there",
      "packages/domain/src/thread-lifecycle.ts":
        "the FSM — which transition each status permits, and the only table that may say so",
    },
    members: threadStatusValues,
    name: "thread status",
  },
  {
    declaredIn: "packages/domain/src/pending-interaction-status.ts",
    dispatchedIn: {
      "packages/db/src/pending-interactions.ts":
        "the STORE — it writes every status and CAS-guards on them; no surface renders this vocabulary today, so there is no label table to keep it company",
    },
    members: pendingInteractionStatusValues,
    name: "pending-interaction status",
  },
];

const CHECKED = VOCABULARIES.filter((vocabulary) => vocabulary.members.length >= TOTALITY_FLOOR);

const namesEveryMember = (source: string, members: readonly string[]): boolean =>
  members.every((member) => new RegExp(`["'\`]${member}["'\`]`, "u").test(source));

const totalDispatchSites = (vocabulary: Vocabulary): string[] =>
  workspaces()
    .flatMap((workspace) => workspaceFiles(workspace).shipped)
    .filter((file) => namesEveryMember(sourceOf(file), vocabulary.members))
    .toSorted();

describe("one total dispatch per domain vocabulary", () => {
  it("reads every vocabulary from its own declaration", () => {
    const violations: string[] = [];
    for (const vocabulary of VOCABULARIES) {
      if (vocabulary.members.length === 0) {
        violations.push(
          `EMPTY VOCABULARY  ${vocabulary.name}\n` +
            `  rule: the members are read from ${vocabulary.declaredIn}; an empty read matches every file in the repo\n` +
            `  fix: the declaration's shape changed — follow it before trusting a green run`,
        );
        continue;
      }
      if (!namesEveryMember(sourceOf(vocabulary.declaredIn), vocabulary.members)) {
        violations.push(
          `VOCABULARY NOT AT ITS DECLARATION  ${vocabulary.name}\n` +
            `  rule: ${vocabulary.declaredIn} is where these members are written down, so it must name all of them\n` +
            `  fix: point \`declaredIn\` at wherever the vocabulary moved to`,
        );
      }
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
    expect(CHECKED.map((vocabulary) => vocabulary.name)).toContain("thread status");
  });

  it("no undeclared file dispatches totally on a domain vocabulary", () => {
    const violations: string[] = [];
    for (const vocabulary of CHECKED) {
      const sites = totalDispatchSites(vocabulary);
      const declared = [vocabulary.declaredIn, ...Object.keys(vocabulary.dispatchedIn)];
      for (const site of sites) {
        if (declared.includes(site)) {
          continue;
        }
        violations.push(
          `SECOND TABLE OVER ${vocabulary.name.toUpperCase()}  ${site}\n` +
            `  it names all ${vocabulary.members.length} members: ${vocabulary.members.join(", ")}\n` +
            `  rule: a total table decides something about EVERY member, and two of them typecheck perfectly while saying different things — the compiler catches a missing arm, never a drifted one\n` +
            `  already dispatched at:\n${declared
              .map((each) => `    ${each}`)
              .join(
                "\n",
              )}\n  fix: call the table that already exists, or add a row to this vocabulary's \`dispatchedIn\` in tools/repo-guards/src/domain-dispatch.test.ts saying what THIS one decides that the others do not`,
        );
      }
    }
    expect(violations, `\n${violations.join("\n\n")}\n`).toEqual([]);
  });

  it("no `dispatchedIn` row is stale", () => {
    const stale: string[] = [];
    for (const vocabulary of CHECKED) {
      const sites = new Set(totalDispatchSites(vocabulary));
      for (const [file, decides] of Object.entries(vocabulary.dispatchedIn)) {
        if (sites.has(file)) {
          continue;
        }
        stale.push(
          `STALE ROW  ${file}\n` +
            `  it no longer dispatches on every ${vocabulary.name}\n` +
            `  the row claimed: ${decides}\n` +
            `  fix: delete the row — an allowance that outlives its table only ever loosens the guard`,
        );
      }
    }
    expect(stale, `\n${stale.join("\n\n")}\n`).toEqual([]);
  });
});
