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

const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*/u;

const NUMBER_RE =
  /^\$?(?<integer>\d{1,3}(?:,\d{3})+|\d+)(?<decimals>\.\d+)?(?<suffix>[kmb])?(?<percent>%)?/iu;

const MAGNITUDES = new Map([
  ["b", 1e9],
  ["k", 1e3],
  ["m", 1e6],
]);

export const isPillName = (text: string) => NAME_RE.exec(text)?.[0] === text;

const numberToken = (match: RegExpExecArray) => {
  const { groups } = match;
  const base = Number(`${(groups?.integer ?? "").replaceAll(",", "")}${groups?.decimals ?? ""}`);
  const scaled = base * (MAGNITUDES.get(groups?.suffix?.toLowerCase() ?? "") ?? 1);

  return { kind: "number", value: groups?.percent === "%" ? scaled / 100 : scaled } satisfies Token;
};

const tokenize = (source: string) => {
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

const parseTokens = (tokens: readonly Token[]) => {
  let position = 0;

  const peek = () => tokens[position];

  const parseFactor: () => ExpressionNode | null = () => {
    const token = peek();

    if (token === undefined) {
      return null;
    }

    if (token.kind === "number") {
      position += 1;

      return { kind: "number", value: token.value } satisfies ExpressionNode | null;
    }

    if (token.kind === "ref") {
      position += 1;

      return { kind: "ref", name: token.name } satisfies ExpressionNode | null;
    }

    if (token.op === "-") {
      position += 1;
      const operand = parseFactor();

      return (
        operand === null ? null : { kind: "negate", operand }
      ) satisfies ExpressionNode | null;
    }

    if (token.op === "(") {
      position += 1;
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

  const parseProduct: () => ExpressionNode | null = () => {
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

  const parseSum: () => ExpressionNode | null = () => {
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
export const parseExpression = (source: string) => {
  const tokens = tokenize(source);

  return tokens === null ? null : parseTokens(tokens);
};

export const namesIn: (node: ExpressionNode) => string[] = (node: ExpressionNode) => {
  switch (node.kind) {
    case "number": {
      return [] satisfies string[];
    }

    case "ref": {
      return [node.name] satisfies string[];
    }

    case "negate": {
      return namesIn(node.operand);
    }

    case "binary": {
      return [...namesIn(node.left), ...namesIn(node.right)] satisfies string[];
    }

    default: {
      throw new Error(`unexpected ${String(node satisfies never)}`);
    }
  }
};

export const renameIn = (source: string, from: string, to: string) => {
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

export const evaluateExpression = (
  node: ExpressionNode,
  valueOf: (name: string) => number | null,
) => {
  const walk: (current: ExpressionNode) => number | null = (current: ExpressionNode) => {
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

          default: {
            throw new Error(`unexpected ${String(current.op satisfies never)}`);
          }
        }
      }

      default: {
        throw new Error(`unexpected ${String(current satisfies never)}`);
      }
    }
  };

  const result = walk(node);

  return result !== null && Number.isFinite(result) ? result : null;
};
