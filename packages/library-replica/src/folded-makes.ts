// The makes the cell folded onto the item already at their address, by the id each was queued
// under. A screen opened on a card still holds that id, so an item's read, a write and the change
// feed answer it as the item it landed on. They last the run: only a url naming a card outlives
// it, and a reload there says the item isn't on this device, which a table would be kept to spare.

export interface FoldedMakes {
  readonly add: (from: string, to: string) => void;
  // the item an id names now
  readonly landedAs: (itemId: string) => string;
  // whether a make folded onto this item
  readonly tookFold: (itemId: string) => boolean;
  // these items' ids, and every id a make folded onto them went by
  readonly namesOf: (ids: ReadonlySet<string>) => ReadonlySet<string>;
}

export const createFoldedMakes = (): FoldedMakes => {
  const folds = new Map<string, string>();
  return {
    add: (from, to) => {
      folds.set(from, to);
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
    tookFold: (itemId) => [...folds.values()].includes(itemId),
  };
};
