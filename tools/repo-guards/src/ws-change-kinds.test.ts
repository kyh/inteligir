// a kind nobody fires is a client waiting forever for a frame no code path sends, and nothing else
// sees it: the compiler is satisfied by the declaration, knip sees importers, the ws-bus suite
// fires the kind itself.

import {
  DOC_CHANGE_KINDS,
  THREAD_CHANGE_KINDS,
  VAULT_CHANGE_KINDS,
} from "@repo/domain/change-kinds";
import { describe, expect, it } from "vitest";
import { sourceOf, workspaceFiles, workspaces } from "./repo";

const ENTITIES = [
  { entity: "vault", notifier: "notifyVault", kinds: VAULT_CHANGE_KINDS },
  { entity: "doc", notifier: "notifyDoc", kinds: DOC_CHANGE_KINDS },
  { entity: "thread", notifier: "notifyThread", kinds: THREAD_CHANGE_KINDS },
] as const;

// empty on purpose: a kind belongs in the contract when the write that announces it exists.
const DECLARED_WITHOUT_PRODUCER: Record<string, string> = {};

const QUOTED = /["']([^"']+)["']/g;

// paren-matched, so a nested CHECK(…) or an inline object cannot end the capture early.
function callArguments(source: string, name: string): string[] {
  const calls: string[] = [];
  const opener = new RegExp(`\\b${name}\\s*\\(`, "g");
  let match = opener.exec(source);
  while (match !== null) {
    let depth = 1;
    let index = match.index + match[0].length;
    const start = index;
    while (index < source.length && depth > 0) {
      const char = source[index];
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      index += 1;
    }
    if (depth === 0) calls.push(source.slice(start, index - 1));
    opener.lastIndex = index;
    match = opener.exec(source);
  }
  return calls;
}

interface Producer {
  entity: string;
  kind: string;
  file: string;
}

function producers(): Producer[] {
  const found: Producer[] = [];
  for (const workspace of workspaces()) {
    for (const file of workspaceFiles(workspace).shipped) {
      // the vocabulary and the seam that types it name every kind and fire none.
      if (file.startsWith("packages/domain/")) continue;
      const source = sourceOf(file);
      for (const { entity, notifier } of ENTITIES) {
        for (const args of callArguments(source, notifier)) {
          QUOTED.lastIndex = 0;
          let quoted = QUOTED.exec(args);
          while (quoted !== null) {
            const kind = quoted[1];
            if (kind !== undefined) found.push({ entity, kind, file });
            quoted = QUOTED.exec(args);
          }
        }
      }
    }
  }
  return found;
}

describe("ws change-kind reachability", () => {
  const fired = producers();

  it("every declared change kind has a producer in shipped source", () => {
    const unreachable: string[] = [];
    for (const { entity, kinds } of ENTITIES) {
      for (const kind of kinds) {
        const id = `${entity}/${kind}`;
        if (id in DECLARED_WITHOUT_PRODUCER) continue;
        if (fired.some((producer) => producer.entity === entity && producer.kind === kind))
          continue;
        unreachable.push(
          `UNREACHABLE CHANGE KIND  ${id}\n` +
            `  rule: a declared change kind is a promise that some write announces itself; nothing outside the suites fires this one\n` +
            `  fix: build the write that fires it, or delete the kind from packages/domain/src/change-kinds.ts`,
        );
      }
    }
    expect(unreachable, `\n${unreachable.join("\n\n")}\n`).toEqual([]);
  });

  it("every kind a producer fires is declared", () => {
    const undeclared: string[] = [];
    for (const producer of fired) {
      const entity = ENTITIES.find((candidate) => candidate.entity === producer.entity);
      if (entity === undefined) continue;
      const declared: readonly string[] = entity.kinds;
      if (declared.includes(producer.kind)) continue;
      undeclared.push(
        `UNDECLARED CHANGE KIND  ${producer.entity}/${producer.kind}\n` +
          `  rule: the domain's kind arrays are the vocabulary; the contract's strict outbound schema rejects anything else at the socket\n` +
          `  at ${producer.file}`,
      );
    }
    expect(undeclared, `\n${undeclared.join("\n\n")}\n`).toEqual([]);
  });

  it("no entry in DECLARED_WITHOUT_PRODUCER is stale", () => {
    const stale: string[] = [];
    for (const [id, gap] of Object.entries(DECLARED_WITHOUT_PRODUCER)) {
      const [entity, kind] = id.split("/");
      const declaredEntity = ENTITIES.find((candidate) => candidate.entity === entity);
      if (declaredEntity === undefined || !declaredEntity.kinds.some((each) => each === kind)) {
        stale.push(
          `STALE EXCEPTION  ${id} is no longer a declared change kind\n` +
            `  fix: delete the entry from DECLARED_WITHOUT_PRODUCER`,
        );
        continue;
      }
      if (fired.some((producer) => producer.entity === entity && producer.kind === kind)) {
        stale.push(
          `STALE EXCEPTION  ${id} now HAS a producer\n` +
            `  the gap it named ("${gap}") is closed\n` +
            `  fix: delete the entry from DECLARED_WITHOUT_PRODUCER`,
        );
      }
    }
    expect(stale, `\n${stale.join("\n\n")}\n`).toEqual([]);
  });

  it("finds the producers it is supposed to find", () => {
    expect(
      fired.some(
        (producer) =>
          producer.entity === "vault" &&
          producer.kind === "files-changed" &&
          producer.file.startsWith("apps/cli/"),
      ),
    ).toBe(true);
    expect(
      fired.some(
        (producer) =>
          producer.entity === "thread" &&
          producer.kind === "thread-created" &&
          producer.file.startsWith("packages/db/"),
      ),
    ).toBe(true);
  });
});
