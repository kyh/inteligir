// Result rendering, per the vendored skill: thousands separators and at most
// two decimal places; `$` and `%` affect PARSING, never the result. One
// deterministic locale — a display computed on two machines must not diff.

const FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  useGrouping: true,
});

export function formatResult(value: number): string {
  // -0 formats as "0": a display of "-0" reads as a bug, not a number.
  return FORMATTER.format(value === 0 ? 0 : value);
}
