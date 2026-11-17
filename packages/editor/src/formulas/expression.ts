// A formula's source: arithmetic over numbers and the names of other pills in the same item.

type Operator = "+" | "-" | "*" | "/";

type Token =
  | { kind: "number"; value: number }
  | { kind: "op"; op: Operator | "(" | ")" }
  | { kind: "ref"; name: string; at: number };

export type ExpressionNode =
  | { kind: "number"; value: number }
  | { kind: "ref"; name: string }
  | { kind: "negate"; operand: ExpressionNode }
  | { kind: "binary"; op: Operator; left: ExpressionNode; right: ExpressionNode };

// no `-`, which a source reads as a minus
const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*/u;
// a malformed thousands run is not a number, so the whole source is text rather than half-parsed
const NUMBER_RE =
  /^\$?(?<integer>\d{1,3}(?:,\d{3})+|\d+)(?<decimals>\.\d+)?(?<suffix>[kmb])?(?<percent>%)?/iu;

const MAGNITUDES = new Map([
  ["b", 1e9],
  ["k", 1e3],
  ["m", 1e6],
]);

// whether a source can spell `text` to read the pill it names
export const isPillName = (text: string): boolean => NAME_RE.exec(text)?.[0] === text;

const numberToken = (match: RegExpExecArray): Token => {
  const { groups } = match;
  const base = Number(`${(groups?.integer ?? "").replaceAll(",", "")}${groups?.decimals ?? ""}`);
  const scaled = base * (MAGNITUDES.get(groups?.suffix?.toLowerCase() ?? "") ?? 1);
  return { kind: "number", value: groups?.percent === "%" ? scaled / 100 : scaled };
};

const tokenize = (source: string): Token[] | null => {
  const tokens: Token[] = [];
  let rest = source;
  for (;;) {
    rest = rest.replace(/^\s+/u, "");
    if (rest === "") {
      break;
    }
    const number = NUMBER_RE.exec(rest);
    if (number !== null) {
      const [whole] = number;
      tokens.push(numberToken(number));
      rest = rest.slice(whole.length);
      continue;
    }
    const [name] = NAME_RE.exec(rest) ?? [];
    if (name !== undefined) {
      tokens.push({ at: source.length - rest.length, kind: "ref", name });
      rest = rest.slice(name.length);
      continue;
    }
    const [op] = rest;
    if (op === "+" || op === "-" || op === "*" || op === "/" || op === "(" || op === ")") {
      tokens.push({ kind: "op", op });
      rest = rest.slice(1);
      continue;
    }
    return null;
  }
  return tokens.length === 0 ? null : tokens;
};

const parseTokens = (tokens: readonly Token[]): ExpressionNode | null => {
  let position = 0;

  const peek = (): Token | undefined => tokens[position];

  const parseFactor = (): ExpressionNode | null => {
    const token = peek();
    if (token === undefined) {
      return null;
    }
    if (token.kind === "number") {
      position += 1;
      return { kind: "number", value: token.value };
    }
    if (token.kind === "ref") {
      position += 1;
      return { kind: "ref", name: token.name };
    }
    if (token.op === "-") {
      position += 1;
      const operand = parseFactor();
      return operand === null ? null : { kind: "negate", operand };
    }
    if (token.op === "(") {
      position += 1;
      // oxlint-disable-next-line no-use-before-define -- recursive descent: factor and sum are mutually recursive, so one is always named before it is defined
      const inner = parseSum();
      const close = peek();
      if (inner === null || close?.kind !== "op" || close.op !== ")") {
        return null;
      }
      position += 1;
      return inner;
    }
    return null;
  };

  const parseProduct = (): ExpressionNode | null => {
    let left = parseFactor();
    for (;;) {
      if (left === null) {
        return null;
      }
      const token = peek();
      if (token?.kind !== "op" || (token.op !== "*" && token.op !== "/")) {
        return left;
      }
      position += 1;
      const right = parseFactor();
      if (right === null) {
        return null;
      }
      left = { kind: "binary", left, op: token.op, right };
    }
  };

  const parseSum = (): ExpressionNode | null => {
    let left = parseProduct();
    for (;;) {
      if (left === null) {
        return null;
      }
      const token = peek();
      if (token?.kind !== "op" || (token.op !== "+" && token.op !== "-")) {
        return left;
      }
      position += 1;
      const right = parseProduct();
      if (right === null) {
        return null;
      }
      left = { kind: "binary", left, op: token.op, right };
    }
  };

  const tree = parseSum();
  return tree !== null && position === tokens.length ? tree : null;
};

/** null = text, not a formula (an answer, not an error). */
export const parseExpression = (source: string): ExpressionNode | null => {
  const tokens = tokenize(source);
  return tokens === null ? null : parseTokens(tokens);
};

// every name the expression reads, as often as it reads it
export const namesIn = (node: ExpressionNode): string[] => {
  switch (node.kind) {
    case "number": {
      return [];
    }
    case "ref": {
      return [node.name];
    }
    case "negate": {
      return namesIn(node.operand);
    }
    case "binary": {
      return [...namesIn(node.left), ...namesIn(node.right)];
    }
    // no default
  }
};

// `source` with every `from` it reads spelled `to`; text that is no formula stays as written
export const renameIn = (source: string, from: string, to: string): string => {
  const tokens = tokenize(source);
  if (tokens === null || parseTokens(tokens) === null) {
    return source;
  }
  let renamed = source;
  for (const token of tokens.toReversed()) {
    if (token.kind === "ref" && token.name === from) {
      renamed = `${renamed.slice(0, token.at)}${to}${renamed.slice(token.at + from.length)}`;
    }
  }
  return renamed;
};

// null where the expression has no value: a name with none, or a result that is not finite
export const evaluateExpression = (
  node: ExpressionNode,
  valueOf: (name: string) => number | null,
): number | null => {
  const walk = (current: ExpressionNode): number | null => {
    switch (current.kind) {
      case "number": {
        return current.value;
      }
      case "ref": {
        return valueOf(current.name);
      }
      case "negate": {
        const operand = walk(current.operand);
        return operand === null ? null : -operand;
      }
      case "binary": {
        const left = walk(current.left);
        const right = walk(current.right);
        if (left === null || right === null) {
          return null;
        }
        switch (current.op) {
          case "+": {
            return left + right;
          }
          case "-": {
            return left - right;
          }
          case "*": {
            return left * right;
          }
          case "/": {
            return left / right;
          }
          // no default
        }
      }
      // no default
    }
  };
  const result = walk(node);
  return result !== null && Number.isFinite(result) ? result : null;
};
