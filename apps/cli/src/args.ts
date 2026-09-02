// bounded client-side as well as server-side: naming the contract's ceiling beats relaying a 400.

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
