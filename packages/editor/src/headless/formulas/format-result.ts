const FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  useGrouping: true,
});

export const formatResult = (value: number) => FORMATTER.format(value === 0 ? 0 : value);
