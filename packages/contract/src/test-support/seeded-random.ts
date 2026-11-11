// The one seeded generator the package's property tests replay: a seed names a sequence, so a
// failing case reruns exactly, and every suite draws from the same algorithm.

/* oxlint-disable no-bitwise -- mulberry32 is 32-bit integer math; the shifts and xors ARE the
   algorithm, and the seeded sequence every property test replays depends on their exact
   wrap-around semantics. */
export const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d_2b_79_f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
};
/* oxlint-enable no-bitwise */

export const pick = <T>(rand: () => number, items: readonly T[]): T => {
  const item = items[Math.floor(rand() * items.length)];
  if (item === undefined) {
    throw new Error("pick from empty list");
  }
  return item;
};
