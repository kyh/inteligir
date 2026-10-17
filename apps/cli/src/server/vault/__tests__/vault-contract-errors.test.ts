// a declared class is what a client narrows on, so a row advertising a code no
// handler raises hands the client a branch that never runs. the other direction
// is not derivable: `vaultRefusals` throws outside the row's typed errors.

import { localContract } from "@repo/contract/local";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VAULT_REFUSALS } from "../vault-refusals";

const ROUTER_FILE = fileURLToPath(new URL("../vault-router.ts", import.meta.url));
const GUARD_FILE = fileURLToPath(new URL("../write-guard.ts", import.meta.url));
const CONTRACT_FILE = "packages/contract/src/local/vault/vault-contract.ts";
const ROUTER_ANCHOR = "\nexport const vaultRouter";

// the call shape, not the token: a comment mentioning `vaultRefusals` must not hand its block the table.
const REFUSING_CALL = /\.use\(vaultRefusals\)\s*\.handler\(/u;
// a guarded write's refusal is built in write-guard.ts from the handler's own constructors
const GUARD_REFUSAL_CALL = /\bguardRefusalError\(\s*errors\b/u;

const handlerBlocks = (source: string): Map<string, string> => {
  const starts = [
    ...source.matchAll(
      /^const \w+ = base\.vault\.(?<row>\w+)\s*(?:\.use\(\w+\)\s*)?\.handler\(/gmu,
    ),
  ].flatMap((match) => {
    const row = match.groups?.row;
    return row === undefined ? [] : [{ at: match.index, row }];
  });
  const routerAt = source.indexOf(ROUTER_ANCHOR);
  if (routerAt === -1) {
    throw new Error(
      `vault-router.ts: no \`${ROUTER_ANCHOR.trim()}\` anchor — the last handler block has no end, ` +
        "and a parse with no end proves nothing",
    );
  }
  const blocks = new Map<string, string>();
  for (const [index, { row, at }] of starts.entries()) {
    blocks.set(row, source.slice(at, starts[index + 1]?.at ?? routerAt));
  }
  return blocks;
};

const constructedCodes = (source: string): Set<string> => {
  const codes = new Set<string>();
  for (const match of source.matchAll(/\berrors\.(?<code>[A-Z_]+)\(/gu)) {
    const code = match.groups?.code;
    if (code !== undefined) {
      codes.add(code);
    }
  }
  return codes;
};

const GUARD_CODES = constructedCodes(readFileSync(GUARD_FILE, "utf-8"));

const producibleCodes = (block: string): Set<string> => {
  const codes = constructedCodes(block);
  if (GUARD_REFUSAL_CALL.test(block)) {
    for (const code of GUARD_CODES) {
      codes.add(code);
    }
  }
  if (REFUSING_CALL.test(block)) {
    for (const wireClass of Object.values(VAULT_REFUSALS)) {
      codes.add(wireClass);
    }
  }
  return codes;
};

describe("the vault contract's declared errors", () => {
  const blocks = handlerBlocks(readFileSync(ROUTER_FILE, "utf-8"));
  const rows = Object.entries(localContract.vault);

  it("finds a handler block for every row, or the parse below proves nothing", () => {
    const missing = rows.map(([row]) => row).filter((row) => !blocks.has(row));
    expect(
      missing,
      `vault-router.ts: no \`const <name> = base.vault.<row>[.use(…)].handler(\` block for these rows`,
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
        `handler has no \`errors.<CODE>(\` for it, nor write-guard.ts behind a \`guardRefusalError(errors\`, and ${
          REFUSING_CALL.test(block)
            ? `\`vaultRefusals\` answers only ${Object.values(VAULT_REFUSALS).join(", ")}`
            : "runs without `vaultRefusals`"
        } — a declared class is a promise a client narrows on; drop it or add a producer`,
    ).toEqual([]);
  });
});
