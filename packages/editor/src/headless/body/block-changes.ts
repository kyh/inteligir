import { sameJson } from "@repo/contract/library/canonical-json";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import type { LibrarySection } from "@repo/contract/library/library-nodes";

import type { BodyChange } from "./body-change";

export const blockChanges = (from: readonly BodyBlock[], to: readonly BodyBlock[]) => {
  const wanted = new Set(to.map(({ block }) => block.id));

  const kept = new Map(
    from.flatMap(({ block }) => (wanted.has(block.id) ? [[block.id, block] as const] : [])),
  );

  const drops = from.flatMap(
    ({ block }) =>
      (kept.has(block.id)
        ? []
        : [{ base: block, blockId: block.id, kind: "drop" }]) satisfies BodyChange[],
  );

  const order = [...kept.keys()];
  const changes: BodyChange[] = [];

  for (const [index, { block, section }] of to.entries()) {
    const afterId = index === 0 ? null : (to[index - 1]?.block.id ?? null);
    const was = kept.get(block.id);

    if (was === undefined) {
      changes.push({ afterId, block, kind: "insertAfter", section });
      order.splice(index, 0, block.id);
      continue;
    }

    if (!sameJson(was, block)) {
      changes.push({ base: was, block, blockId: block.id, kind: "put" });
    }

    if (order[index] !== block.id) {
      changes.push({ afterId, base: was, blockId: block.id, kind: "move" });
      order.splice(order.indexOf(block.id), 1);
      order.splice(index, 0, block.id);
    }
  }

  return [...drops, ...changes] satisfies BodyChange[];
};

export const sectionChanges = (from: readonly BodyBlock[], to: readonly BodyBlock[]) => {
  const was = new Map(from.map(({ block, section }) => [block.id, section]));

  return new Map(
    to.flatMap(({ block, section }) => {
      const held = was.get(block.id);

      return held === undefined || held === section ? [] : [[block.id, section] as const];
    }),
  ) satisfies ReadonlyMap<string, LibrarySection>;
};
