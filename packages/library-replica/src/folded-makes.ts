// The makes the cell folded onto the item already at their address, by the id each was queued
// under. A screen opened on a card still holds that id, so an item's read, a write and the change
// feed answer it as the item it landed on. No screen outlives the run, so no table keeps them.

export interface FoldedMakes {
  readonly add: (from: string, to: string) => void;
  readonly clear: () => void;
  // the item an id names now
  readonly landedAs: (itemId: string) => string;
  // these items' ids, and every id a make folded onto them went by
  readonly namesOf: (ids: ReadonlySet<string>) => ReadonlySet<string>;
}

export const createFoldedMakes = (): FoldedMakes => {
  const folds = new Map<string, string>();
  return {
    add: (from, to) => {
      folds.set(from, to);
    },
    clear: () => {
      folds.clear();
    },
    landedAs: (itemId) => folds.get(itemId) ?? itemId,
    namesOf: (ids) => {
      const names = new Set(ids);
      for (const [from, to] of folds) {
        if (ids.has(to)) {
          names.add(from);
        }
      }
      return names;
    },
  };
};
