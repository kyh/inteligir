// ---------------------------------------------------------------------------
// Change-kind reachability: the ws invalidation bus's vocabulary against its
// producers.
//
// The bus is invalidation-only, so a change kind is not a feature — it is a
// PROMISE that some write announces itself. A kind nobody fires is worse than
// dead code: a client subscribes for it, dispatches on it, and waits forever
// for a frame that no code path can send. Nothing else in the repo can see
// that. The compiler is satisfied by the declaration; knip sees an exported
// const with importers; the ws-bus suite passes because it fires the kind
// itself.
//
// So both directions are walked over shipped source: every declared kind needs
// a `notify<Entity>([… "kind" …])` call somewhere that is not a test, and every
// kind such a call passes must be declared.
//
// Sibling of packages/ui's no-orphan-components guard, and the same shape the
// deleted `no-dead-channels` had: assert the architectural rule as a failing
// test over a walk of the real tree.
// ---------------------------------------------------------------------------

import {
  DOC_CHANGE_KINDS,
  SYSTEM_CHANGE_KINDS,
  THREAD_CHANGE_KINDS,
  VAULT_CHANGE_KINDS,
} from "@repo/server-contract/notifications";
import { describe, expect, it } from "vitest";
import { sourceOf, workspaceFiles, workspaces } from "./repo";

/** Entity → the kinds the contract declares → the call that fires one. */
const ENTITIES = [
  { entity: "system", notifier: "notifySystem", kinds: SYSTEM_CHANGE_KINDS },
  { entity: "vault", notifier: "notifyVault", kinds: VAULT_CHANGE_KINDS },
  { entity: "doc", notifier: "notifyDoc", kinds: DOC_CHANGE_KINDS },
  { entity: "thread", notifier: "notifyThread", kinds: THREAD_CHANGE_KINDS },
] as const;

/**
 * Kinds the contract declares that NO shipped producer fires. Each is an open
 * gap, not a sanctioned state — the list exists so the other nine kinds stay
 * guarded while these two are resolved, and the drain test below fails the
 * moment one gains a producer, so a fix cannot leave a stale entry behind.
 *
 * Resolving one means either building the write that announces it or deleting
 * the kind. Both are contract changes with consumers to move, which is why
 * neither happened inside the change that added this guard.
 */
const DECLARED_WITHOUT_PRODUCER: Record<string, string> = {
  // The whole `system` entity has no writer. The UI subscribes to it
  // (apps/app/src/app/workspace-context.tsx) and invalidates the system-status
  // query on it, so the subscription is live and the frame is unreachable.
  "system/config-changed": "the `system` entity has no writer; only the suites call notifySystem",
  // No thread deletion exists anywhere: no route row, no ThreadService method,
  // no @repo/db function. Carried in with the rest of bb's contract.
  "thread/thread-deleted": "nothing in this repo deletes a thread",
};

const QUOTED = /["']([^"']+)["']/g;

/** The argument text of every `name(` call in the source, paren-matched so a
 *  nested `CHECK(…)` or an inline object cannot end the capture early. */
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
      // The contract itself names every kind; it declares them, it fires none.
      if (file.startsWith("packages/server-contract/")) continue;
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
            `  fix: build the write that fires it, or delete the kind from packages/server-contract/src/notifications.ts`,
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
          `  rule: the contract's kind arrays are the vocabulary; the strict outbound schema rejects anything else at the socket\n` +
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
    // A walk that silently matched nothing would pass every assertion above
    // for the wrong reason, so pin two producers this repo actually has.
    expect(
      fired.some(
        (producer) =>
          producer.entity === "vault" &&
          producer.kind === "files-changed" &&
          producer.file.startsWith("apps/app/"),
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
