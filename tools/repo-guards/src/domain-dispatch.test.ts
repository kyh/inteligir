// ---------------------------------------------------------------------------
// One total dispatch per domain vocabulary, and every extra one declared.
//
// TypeScript catches a MISSING arm. It has nothing at all to say about a
// DRIFTED one: two tables covering the same eight states with three different
// sentences typecheck perfectly, and a ninth state added to one and forgotten
// in the other is caught by neither the compiler nor any other guard here.
// That is not hypothetical — `vault-hooks.ts`'s own docstring records two
// label tables that drifted on half their states, so one vault answered
// "Waiting on the agent" in the sidebar and "Waiting on an agent turn" in
// settings, and a user comparing two pieces of one window could not tell a
// wording difference from a state difference. It then happened AGAIN, with the
// pill's colour table.
//
// The signal is TOTALITY. A file that names every member of a closed
// vocabulary is holding a total table over it — a `switch`, a
// `Record<Status, …>`, an if-chain — whatever it is spelled as. So each
// vocabulary below names where it is DECLARED and every file allowed to
// dispatch totally on it, with what that dispatch decides. A new total table
// fails, naming both sites; a declared one that stops dispatching drains.
//
// The reasons are the point. Three consumers of thread status is not
// redundancy — one decides which transition is legal, one what a send does,
// one what the user sees — and writing that down is what makes a FOURTH one
// answerable. The row is the review surface.
//
// Two limits, stated rather than implied. Members are matched as quoted
// literals, so a table built by iterating the vocabulary array is invisible
// here — correctly, since that table cannot drift. And a vocabulary of fewer
// than three members is skipped: "names both of its two values" is a
// coincidence, not a total dispatch, and every producer would trip it.
//
// THE FLOOR STAYS AT TOTALITY, and that is a decision rather than an
// oversight. Partial dispatch is a real drift class — three surfaces each
// answering half the sync-state question is what `vault-hooks.ts` records —
// but "names a subset nobody derived" cannot be asked of this detector, for a
// reason in its own mechanism: a subset that DERIVES spells its members as
// quoted literals too. `vault-service.ts` holds its refusal classes in a
// `satisfies readonly ApiErrorCode[]` array, compiler-tied to the vocabulary,
// and reads here exactly like a hand-written union would. That is not true of
// a TOTAL table — one built by iterating the array names no literal at all —
// which is precisely why the totality rule can be trusted and a subset rule
// cannot.
//
// The measurement, so the next reader does not have to retake it: at a
// three-member floor the widened rule fires on nine sites and none of them is
// drift. Six are producers naming the classes they throw or the kinds they
// announce, at unrelated call sites, deciding nothing jointly. One is
// `packages/ui/src/components/geometric-orb.tsx`, which names "idle",
// "starting" and "error" as its own prop vocabulary in a leaf that cannot
// import `@repo/domain` at all — a collision of common words the detector has
// no way to tell from the real thing. Nine exemption rows whose reason is
// uniformly "these are not one decision" is a guard that gets muted, and a
// muted guard protects less than a narrow one.
//
// What DOES catch partial dispatch is making the subset a derivation, which
// turns it into either a total table this rule already sees
// (`thread-hooks.ts`) or a compile error at the array. That is the move; the
// guard is not the place it happens.
// ---------------------------------------------------------------------------

import {
  DOC_CHANGE_KINDS,
  THREAD_CHANGE_KINDS,
  VAULT_CHANGE_KINDS,
} from "@repo/domain/change-kinds";
import { pendingInteractionStatusValues } from "@repo/domain/pending-interaction-status";
import { threadStatusValues } from "@repo/domain/thread-status";
import { API_ERROR_CODES } from "@repo/server-contract/errors";
import { vaultStatusResponseSchema } from "@repo/server-contract/vault";
import { describe, expect, it } from "vitest";
import { sourceOf, workspaceFiles, workspaces } from "./repo";

/** Below this, "names every member" is a coincidence rather than a table. */
const TOTALITY_FLOOR = 3;

/**
 * The sync states, read off the contract's own discriminated union — there is
 * no exported tuple to copy, and copying one here is the failure this whole
 * file is about. The self-check below fails if zod's shape ever stops
 * yielding them, rather than letting an empty vocabulary pass everything.
 */
const syncStates: string[] = (
  vaultStatusResponseSchema as unknown as {
    options: { shape: Record<string, { value?: unknown }> }[];
  }
).options.map((option) => String(option.shape["state"]?.value));

interface Vocabulary {
  /** The domain word, as the failure says it. */
  name: string;
  members: readonly string[];
  /** Where the vocabulary itself is declared; naming every member is its job. */
  declaredIn: string;
  /** Every other file allowed to dispatch totally on it → what it decides. */
  dispatchedIn: Record<string, string>;
}

const VOCABULARIES: Vocabulary[] = [
  {
    name: "vault sync state",
    members: syncStates,
    declaredIn: "packages/server-contract/src/vault.ts",
    dispatchedIn: {
      "apps/app/src/node/vault/git.ts":
        "the PRODUCER — `statusSnapshot` is the state machine that decides which state the vault is in; naming them all is what it is for",
      "apps/app/src/app/vault-hooks.ts":
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
      "apps/app/src/node/threads/service.ts":
        "server POLICY — what a send does in each status (start, steer, queue, refuse), which is a different question from what the status is called",
      "apps/app/src/app/chat/chat-model.ts":
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
    name: "API error class",
    members: API_ERROR_CODES,
    declaredIn: "packages/server-contract/src/errors.ts",
    dispatchedIn: {},
  },
  {
    name: "thread change kind",
    members: THREAD_CHANGE_KINDS,
    declaredIn: "packages/domain/src/change-kinds.ts",
    dispatchedIn: {
      "apps/app/src/app/chat/thread-hooks.ts":
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

/** Vocabularies big enough for "names every member" to mean something. */
const CHECKED = VOCABULARIES.filter((vocabulary) => vocabulary.members.length >= TOTALITY_FLOOR);

function namesEveryMember(source: string, members: readonly string[]): boolean {
  return members.every((member) => new RegExp(`["'\`]${member}["'\`]`).test(source));
}

/** The shipped files holding a total table over this vocabulary. */
function totalDispatchSites(vocabulary: Vocabulary): string[] {
  return workspaces()
    .flatMap((workspace) => workspaceFiles(workspace).shipped)
    .filter((file) => namesEveryMember(sourceOf(file), vocabulary.members))
    .toSorted();
}

describe("one total dispatch per domain vocabulary", () => {
  it("reads every vocabulary from its own declaration", () => {
    // A vocabulary that came back empty would make `every` vacuously true and
    // flag the whole repo; one that came back short would flag nothing. Both
    // are silent, so both are checked here.
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
