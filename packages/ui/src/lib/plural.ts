const COUNT_FORMAT = new Intl.NumberFormat("en-US");

export const formatCount = (count: number) => COUNT_FORMAT.format(count);

export const plural = (count: number, one: string, many = `${one}s`) =>
  `${formatCount(count)} ${count === 1 ? one : many}`;
