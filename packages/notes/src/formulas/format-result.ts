// one fixed locale: a display computed on two machines must not diff
const FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  useGrouping: true,
});

export function formatResult(value: number): string {
  // -0 would print as "-0"
  return FORMATTER.format(value === 0 ? 0 : value);
}
