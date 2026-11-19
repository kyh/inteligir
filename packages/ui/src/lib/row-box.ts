// @license MIT, vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism).

export interface ItemRect {
  top: number;
  height: number;
  left: number;
  width: number;
}

export interface RowBox {
  rect: ItemRect;
  row: HTMLElement;
  travels: boolean;
}

const offsetBox = (row: HTMLElement) =>
  ({
    height: row.offsetHeight,
    left: row.offsetLeft,
    top: row.offsetTop,
    width: row.offsetWidth,
  }) satisfies ItemRect;

const sameRect = (a: ItemRect, b: ItemRect) =>
  a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;

export const rowBox = (
  row: HTMLElement | null,
  last: RowBox | null,
  measure: (row: HTMLElement) => ItemRect = offsetBox,
) => {
  if (
    row === null ||
    (row.offsetParent === null && row.offsetWidth === 0 && row.offsetHeight === 0)
  ) {
    return null;
  }

  const rect = measure(row);

  if (last?.row !== row) {
    return { rect, row, travels: true } satisfies RowBox | null;
  }

  return (sameRect(last.rect, rect) ? last : { rect, row, travels: false }) satisfies RowBox | null;
};
