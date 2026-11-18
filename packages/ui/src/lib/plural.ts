const COUNT_FORMAT = new Intl.NumberFormat("en-US");

// "8,512": every count a person reads
export const formatCount = (count: number): string => COUNT_FORMAT.format(count);

// "1 note", "8,512 notes": the one spelling of a counted noun in product copy
export const plural = (count: number, one: string, many = `${one}s`): string =>
  `${formatCount(count)} ${count === 1 ? one : many}`;
