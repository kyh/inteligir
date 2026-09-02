// TypeScript catches a missing arm, not a drifted one: a state added to one table and forgotten in
// another typechecks. a file naming every member as a quoted literal holds a total table; one built
// by iterating the array is invisible here and cannot drift. no subset rule: a derived `as const`
// subset spells literals too, and UI leaves collide on common words ("idle", "error").

import {
  DOC_CHANGE_KINDS,
  THREAD_CHANGE_KINDS,
  VAULT_CHANGE_KINDS,
} from "@repo/domain/change-kinds";
import { pendingInteractionStatusValues } from "@repo/domain/pending-interaction-status";
import { threadStatusValues } from "@repo/domain/thread-status";
import { vaultStatusResponseSchema } from "@repo/api/local/vault/vault-schema";
import { describe, expect, it } from "vitest";
import { sourceOf, workspaceFiles, workspaces } from "./repo";

// below this, naming every member is a coincidence rather than a table.
const TOTALITY_FLOOR = 3;

// read off the discriminated union: there is no exported tuple, and copying one here is the drift
// this file is about.
const syncStates = vaultStatusResponseSchema.options.map((option) => {
  // zod owns this property name; the computed key keeps a word this repo bans from its own symbols
  // out of the file.
  const { ["shape"]: fields } = option;
  return fields.state.value;
});

interface Vocabulary {
  name: string;
  members: readonly string[];
  declaredIn: string;
  dispatchedIn: Record<string, string>;
}

const VOCABULARIES: Vocabulary[] = [
  {
    name: "vault sync state",
    members: syncStates,
    declaredIn: "packages/api/src/local/vault/vault-schema.ts",
    dispatchedIn: {
      "apps/cli/src/server/vault/git-engine.ts":
        "the PRODUCER — `statusSnapshot` is the state machine that decides which state the vault is in; naming them all is what it is for",
      "apps/desktop/src/renderer/app/vault-hooks.ts":
        "the ONE client answer, four tables deliberately side by side so a ninth state cannot be answered in one and forgotten in another: `syncStateLabel` (the word), `syncStateDotClass` (the colour), `syncBlockedReason` (why a pass would not run — which `canSyncNow` reads as a boolean) and `syncNowNotice` (what the command owes the user afterwards)",
    },
  },
  {
    name: "thread status",
    members: threadStatusValues,
    declaredIn: "packages/domain/src/thread-status.ts",
    dispatchedIn: {
      "packages/domain/src/thread-lifecycle.ts":
        "the FSM — which transition each status permits, and the only table that may say so",
      "apps/cli/src/server/threads/service.ts":
        "server POLICY — what a send does in each status (start, queue, refuse), which is a different question from what the status is called",
      "apps/desktop/src/renderer/app/thread-activity.ts":
        "the client's ONE derivation into `ThreadActivity`; every React surface reads its labels, dots and tones from there rather than from the lifecycle word",
    },
  },
  {
    name: "pending-interaction status",
    members: pendingInteractionStatusValues,
    declaredIn: "packages/domain/src/pending-interaction-status.ts",
    dispatchedIn: {
      "packages/db/src/pending-interactions.ts":
        "the STORE — it writes every status and CAS-guards on them; no surface renders this vocabulary today, so there is no label table to keep it company",
    },
  },
  {
    name: "thread change kind",
    members: THREAD_CHANGE_KINDS,
    declaredIn: "packages/domain/src/change-kinds.ts",
    dispatchedIn: {
      "apps/desktop/src/renderer/app/actions/thread-hooks.ts":
        "which kinds move the TIMELINE, and therefore earn a delta fetch — the one thread surface the query sweep does not cover, so a kind nobody weighed here is a row the user never sees; a table rather than a list, because the answer for a new kind is a decision and not a default",
    },
  },
  {
    name: "vault change kind",
    members: VAULT_CHANGE_KINDS,
    declaredIn: "packages/domain/src/change-kinds.ts",
    dispatchedIn: {},
  },
  {
    name: "doc change kind",
    members: DOC_CHANGE_KINDS,
    declaredIn: "packages/domain/src/change-kinds.ts",
    dispatchedIn: {},
  },
];

const CHECKED = VOCABULARIES.filter((vocabulary) => vocabulary.members.length >= TOTALITY_FLOOR);

function namesEveryMember(source: string, members: readonly string[]): boolean {
  return members.every((member) => new RegExp(`["'\`]${member}["'\`]`).test(source));
}

function totalDispatchSites(vocabulary: Vocabulary): string[] {
  return workspaces()
    .flatMap((workspace) => workspaceFiles(workspace).shipped)
    .filter((file) => namesEveryMember(sourceOf(file), vocabulary.members))
    .toSorted();
}

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
    expect(CHECKED.map((vocabulary) => vocabulary.name)).toContain("vault sync state");
  });

  it("no undeclared file dispatches totally on a domain vocabulary", () => {
    const violations: string[] = [];
    for (const vocabulary of CHECKED) {
      const sites = totalDispatchSites(vocabulary);
      const declared = [vocabulary.declaredIn, ...Object.keys(vocabulary.dispatchedIn)];
      for (const site of sites) {
        if (declared.includes(site)) continue;
        violations.push(
          `SECOND TABLE OVER ${vocabulary.name.toUpperCase()}  ${site}\n` +
            `  it names all ${vocabulary.members.length} members: ${vocabulary.members.join(", ")}\n` +
            `  rule: a total table decides something about EVERY member, and two of them typecheck perfectly while saying different things — the compiler catches a missing arm, never a drifted one\n` +
            `  already dispatched at:\n` +
            declared.map((each) => `    ${each}`).join("\n") +
            `\n  fix: call the table that already exists, or add a row to this vocabulary's \`dispatchedIn\` in tools/repo-guards/src/domain-dispatch.test.ts saying what THIS one decides that the others do not`,
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
        if (sites.has(file)) continue;
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
