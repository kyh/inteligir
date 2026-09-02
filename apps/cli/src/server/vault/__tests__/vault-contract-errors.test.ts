// a declared class is what a client narrows on, so a row advertising a code no
// handler raises hands the client a branch that never runs. the other direction
// is not derivable: `refusing` throws outside the row's typed errors.

import { localContract } from "@repo/api/local";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VAULT_REFUSALS } from "../vault-refusals";

const ROUTER_FILE = fileURLToPath(new URL("../vault-router.ts", import.meta.url));
const CONTRACT_FILE = "packages/api/src/local/vault/vault-contract.ts";
const ROUTER_ANCHOR = "\nexport const vaultRouter";

// the call shape, not the token: a comment mentioning `refusing(` must not hand its block the table.
const REFUSING_CALL = /\brefusing\(\s*(?:async\s*)?\(/u;

function handlerBlocks(source: string): Map<string, string> {
  const starts = [...source.matchAll(/^const \w+ = base\.vault\.(\w+)\.handler\(/gmu)].flatMap(
    (match) => (match[1] === undefined ? [] : [{ row: match[1], at: match.index }]),
  );
  const routerAt = source.indexOf(ROUTER_ANCHOR);
  if (routerAt === -1) {
    throw new Error(
      `vault-router.ts: no \`${ROUTER_ANCHOR.trim()}\` anchor — the last handler block has no end, ` +
        "and a parse with no end proves nothing",
    );
  }
  const blocks = new Map<string, string>();
  starts.forEach(({ row, at }, index) => {
    blocks.set(row, source.slice(at, starts[index + 1]?.at ?? routerAt));
  });
  return blocks;
}

function producibleCodes(block: string): Set<string> {
  const codes = new Set<string>();
  for (const match of block.matchAll(/\berrors\.([A-Z_]+)\(/gu)) {
    if (match[1] !== undefined) codes.add(match[1]);
  }
  if (REFUSING_CALL.test(block)) {
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
        (REFUSING_CALL.test(block)
          ? `\`refusing\` answers only ${Object.values(VAULT_REFUSALS).join(", ")}`
          : "runs outside `refusing`") +
        " — a declared class is a promise a client narrows on; drop it or add a producer",
    ).toEqual([]);
  });
});
