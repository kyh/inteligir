// ---------------------------------------------------------------------------
// What deleting a vault file is allowed to PROMISE.
//
// A delete is a tombstone, and no channel reads a tombstone's bytes back: there
// is no trash view, no restore, no purge-sooner. `docs/privacy.md` is the
// contract and states it plainly. The copy around the delete drifted away from
// it in three separate places at once — the dialog a user approves, the dialog
// the agent's proposal raises, and the sentence the grant table hands the model
// — because each is written where its own feature lives and none of them can
// see the others. So the rule lives here, once, over all three.
//
// The check has TWO halves, and both are load-bearing:
//
//   • no recovery PROMISE — phrases, not words, because "moves to the trash"
//     and "there is no trash view" share every word that matters;
//   • an explicit DENIAL — otherwise deleting the promise satisfies the rule
//     and the user is told nothing at all, which is how the copy got here.
//
// Textual and sliced, like the rest of this package. Each site is read between
// the marker that opens its entry and the next occurrence of that same marker
// key, so reordering the surrounding entries cannot silently widen the slice —
// and comments are stripped first, so a rule stated in prose above the copy can
// never stand in for the copy saying it.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

/** A way back, promised. Every one of these is a phrase a reader would act on. */
const PROMISES = [
  "system trash",
  "vault's trash",
  "moves to the trash",
  "to the trash",
  "from the trash",
  "restore it",
  "restored from",
  "can restore",
  "can be restored",
  "recoverable",
  "30 days",
];

/** The truth, stated. One of these has to be in the copy — and it is cut out
 * before the promises are looked for, because a denial is spelled with the very
 * words a promise is ("no way to restore it"). */
const DENIALS = [
  /can'?t be undone/gi,
  /cannot be undone/gi,
  /no way to restore it/gi,
  /no restore/gi,
  /nothing restores it/gi,
];

type Site = {
  /** Repo-relative file. */
  readonly file: string;
  /** The line that opens the entry to read. */
  readonly opens: string;
  /** The key whose NEXT occurrence closes it. */
  readonly closes: string;
  /** What this copy is, for the failure message. */
  readonly what: string;
};

const SITES: readonly Site[] = [
  {
    file: "packages/workspace/src/components/confirm-vault-delete.ts",
    opens: "confirm({",
    closes: "});",
    what: "the dialog a user approves a delete in",
  },
  {
    file: "apps/web/src/worker/agent/agent-tools.ts",
    opens: 'name: "delete_note"',
    closes: 'name: "',
    what: "the agent's delete_note tool — its proposal dialog and its result",
  },
  {
    file: "packages/bridge/src/agent-grants.ts",
    opens: 'capability: "deleteVaultEntry"',
    closes: 'capability: "',
    what: "the sentence the grant table hands the model",
  },
];

/** The entry's own text: from `opens` to the next `closes` after it. */
function slice(site: Site): string {
  const source = fs.readFileSync(path.join(REPO_ROOT, site.file), "utf8");
  const start = source.indexOf(site.opens);
  if (start < 0) throw new Error(`${site.file} no longer contains ${site.opens}`);
  const after = start + site.opens.length;
  const end = source.indexOf(site.closes, after);
  return source.slice(after, end < 0 ? source.length : end);
}

/** Drop block and line comments — prose ABOVE the copy may not stand in for
 * the copy, and this package's own files are the reason to check that. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

describe("delete copy", () => {
  it.each(SITES)("$what promises no way back", (site) => {
    const copy = stripComments(slice(site)).toLowerCase();
    // A floor: a slice that collapsed to nothing would pass the promise half
    // and fail the denial half for the wrong reason.
    expect(copy.length, `${site.file}: the slice is empty — the markers moved`).toBeGreaterThan(50);

    const denied = DENIALS.reduce((text, denial) => text.replace(denial, " "), copy);
    expect(
      denied !== copy,
      `${site.file} does not say the delete cannot be undone. Removing the ` +
        `false promise is half of it; the copy has to state the truth.`,
    ).toBe(true);

    const promised = PROMISES.filter((phrase) => denied.includes(phrase));
    expect(
      promised,
      `${site.file} offers a way back out of a delete that has none. ` +
        `docs/privacy.md is the contract:\n${promised.join("\n")}`,
    ).toEqual([]);
  });
});
