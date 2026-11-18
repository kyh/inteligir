// What turns one body into another by block id, as `applyBodyChanges` lays it on an editor holding
// the first: a block the second lacks dropped, one it changed put, one it adds inserted after the
// block before it there, and one out of its place moved there. Every base is the block as `from`
// holds it, so the changes land only on the body they were read from. A block's section is no
// change of these: a put keeps the section it lands in, so a writer laying the second body sets
// the sections that differ (`sectionChanges`).

import { sameJson } from "@repo/contract/library/canonical-json";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import type { LibrarySection } from "@repo/contract/library/library-nodes";

import type { BodyChange } from "./body-change";

export const blockChanges = (
  from: readonly BodyBlock[],
  to: readonly BodyBlock[],
): BodyChange[] => {
  const wanted = new Set(to.map(({ block }) => block.id));
  const kept = new Map(
    from.flatMap(({ block }) => (wanted.has(block.id) ? [[block.id, block] as const] : [])),
  );
  const drops = from.flatMap(({ block }): BodyChange[] =>
    kept.has(block.id) ? [] : [{ base: block, blockId: block.id, kind: "drop" }],
  );
  // the order the blocks stand in as each change lands, which a move is read against
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
  return [...drops, ...changes];
};

// each block `from` holds in another section than `to` does, by its id, with the one `to` gives it
export const sectionChanges = (
  from: readonly BodyBlock[],
  to: readonly BodyBlock[],
): ReadonlyMap<string, LibrarySection> => {
  const was = new Map(from.map(({ block, section }) => [block.id, section]));
  return new Map(
    to.flatMap(({ block, section }) => {
      const held = was.get(block.id);
      return held === undefined || held === section ? [] : [[block.id, section] as const];
    }),
  );
};
