// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.

export interface ItemRect {
  top: number;
  height: number;
  left: number;
  width: number;
}

// A lit row and where it sits in its list's layout space. `travels` is false when the row's own
// box changed under it (rows inserted above it, a resize): its pill is redrawn where the row now
// is, since a spring there would trail the row it marks.
export interface RowBox {
  rect: ItemRect;
  row: HTMLElement;
  travels: boolean;
}

// offset*, not getBoundingClientRect: layout values ignore a transform on the container (the
// popup's scale-in) and match the space position: absolute children use
const offsetBox = (row: HTMLElement): ItemRect => ({
  height: row.offsetHeight,
  left: row.offsetLeft,
  top: row.offsetTop,
  width: row.offsetWidth,
});

const sameRect = (a: ItemRect, b: ItemRect): boolean =>
  a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;

// `last` is the pill's previous reading, handed back as it is when its row has not moved
export const rowBox = (
  row: HTMLElement | null,
  last: RowBox | null,
  measure: (row: HTMLElement) => ItemRect = offsetBox,
): RowBox | null => {
  // a row out of the document or in a hidden list has no offsetParent and reports 0 for every
  // offset, which would pin its pill to the top; a position: fixed row also lacks an offsetParent
  // but does have a size, so the box is the test
  if (
    row === null ||
    (row.offsetParent === null && row.offsetWidth === 0 && row.offsetHeight === 0)
  ) {
    return null;
  }
  const rect = measure(row);
  if (last?.row !== row) {
    return { rect, row, travels: true };
  }
  return sameRect(last.rect, rect) ? last : { rect, row, travels: false };
};
