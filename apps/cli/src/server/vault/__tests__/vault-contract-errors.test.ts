// EVERY ERROR A VAULT ROW DECLARES HAS A PRODUCER. A declared class is what a
// client narrows on (`isDefinedError(error) && error.code === …`), so a row
// advertising a code no handler raises hands the client a branch that never
// runs — while the refusal it meant to catch arrives as another class and
// falls through to the generic path.
//
// Derived from both sides rather than listed: the codes come from the contract
// rows themselves, and a producer is either an explicit `errors.<CODE>(` in
// that row's handler or, for a handler running under `refusing`, a class
// `vaultWireError`'s table can answer. The compiler already holds the other
// direction — `errors.X` for an undeclared X does not build.

import { localContract } from "@repo/api/local";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VAULT_REFUSALS } from "../vault-refusals";

const ROUTER_FILE = fileURLToPath(new URL("../vault-router.ts", import.meta.url));
const CONTRACT_FILE = "packages/api/src/local/vault/vault-contract.ts";

/** One handler's source, keyed by its contract row. A block runs from its
 *  `base.vault.<row>.handler(` to the next handler's, or to the router. */
function handlerBlocks(source: string): Map<string, string> {
  const starts = [...source.matchAll(/^const \w+ = base\.vault\.(\w+)\.handler\(/gmu)].flatMap(
    (match) => (match[1] === undefined ? [] : [{ row: match[1], at: match.index }]),
  );
  const routerAt = source.indexOf("\nexport const vaultRouter");
  const blocks = new Map<string, string>();
  starts.forEach(({ row, at }, index) => {
    blocks.set(row, source.slice(at, starts[index + 1]?.at ?? routerAt));
  });
  return blocks;
}

/** The classes a handler block can raise: every explicit `errors.<CODE>(`,
 *  plus the whole translation table when the block runs under `refusing`. */
function producibleCodes(block: string): Set<string> {
  const codes = new Set<string>();
  for (const match of block.matchAll(/\berrors\.([A-Z_]+)\(/gu)) {
    if (match[1] !== undefined) codes.add(match[1]);
  }
  if (block.includes("refusing(")) {
    for (const wireClass of Object.values(VAULT_REFUSALS)) codes.add(wireClass);
  }
  return codes;
}

describe("the vault contract's declared errors", () => {
  const blocks = handlerBlocks(readFileSync(ROUTER_FILE, "utf8"));
  const rows = Object.entries(localContract.vault);

  it("finds a handler block for every row, or the parse below proves nothing", () => {
    const missing = rows.map(([row]) => row).filter((row) => !blocks.has(row));
    expect(
      missing,
      `vault-router.ts: no \`const <name> = base.vault.<row>.handler(\` block for these rows`,
    ).toEqual([]);
  });

  it.each(rows)("row %s declares only classes its handler can raise", (row, procedure) => {
    const declared = Object.keys(procedure["~orpc"].errorMap);
    const block = blocks.get(row) ?? "";
    const producible = producibleCodes(block);
    const unreachable = declared.filter((code) => !producible.has(code));
    expect(
      unreachable,
      `${CONTRACT_FILE}: row "${row}" declares ${unreachable.join(", ")} but vault-router.ts's ` +
        `handler has no \`errors.<CODE>(\` for it and ` +
        (block.includes("refusing(")
          ? `\`refusing\` answers only ${Object.values(VAULT_REFUSALS).join(", ")}`
          : "runs outside `refusing`") +
        " — a declared class is a promise a client narrows on; drop it or add a producer",
    ).toEqual([]);
  });
});
