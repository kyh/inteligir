// one word for sh, whatever it holds: single-quoted, so `$(…)`, backticks, `$x` and globs are text,
// and a quote inside ends the quoting, is escaped, and starts it again. Every launcher the app
// writes and every command it hands an agent quotes through it.

export const shellQuote = (value: string): string => `'${value.replaceAll("'", String.raw`'\''`)}'`;
