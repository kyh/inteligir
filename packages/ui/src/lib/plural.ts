// "1 note", "3 notes": the one spelling of a counted noun in product copy
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}
