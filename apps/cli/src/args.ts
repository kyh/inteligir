// Flag values, parsed once for every leaf that takes one.
//
// citty hands every flag over as text, so each numeric flag needs the same
// three answers — is it a number, is it whole, is it in range — and three
// leaves writing them separately is three sentences for one user mistake.
// BOUNDED HERE as well as server-side: an out-of-range value is the caller's
// own error, and naming the ceiling beats relaying a 400. The ceiling is
// always the contract's, per route — never a number a command file picked.

import { invalidUsage } from "./cli-error";

export function parseBoundedInteger(
  rawValue: string,
  flag: string,
  bounds: { min: number; max?: number },
): number {
  const value = Number(rawValue);
  const range =
    bounds.max === undefined
      ? `at least ${String(bounds.min)}`
      : `between ${String(bounds.min)} and ${String(bounds.max)}`;
  if (
    !Number.isInteger(value) ||
    value < bounds.min ||
    (bounds.max !== undefined && value > bounds.max)
  ) {
    throw invalidUsage(`${flag} must be an integer ${range} (got "${rawValue}")`);
  }
  return value;
}
