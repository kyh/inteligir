// Constant-time, length-checked first because `timingSafeEqual` throws on a
// length mismatch. Every caller compares a value a counterparty is guessing
// at (a pairing state, an OAuth state), so equality is compared the way a
// secret is — one spelling, so no site quietly regresses to `===`.

import { timingSafeEqual } from "node:crypto";

export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
