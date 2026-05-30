export type ShapeClasses = {
  item: string;
  bg: string;
  focusRing: string;
  mergedBg: string;
  container: string;
  button: string;
  input: string;
};

const shape: ShapeClasses = {
  item: "rounded-[20px]",
  bg: "rounded-[20px]",
  focusRing: "rounded-[22px]",
  mergedBg: "rounded-2xl",
  container: "rounded-3xl",
  button: "rounded-[20px]",
  input: "rounded-[20px]",
};

export function getShape(): ShapeClasses {
  return shape;
}
