// The executable-expression grammar, exactly as the vendored skill states it:
// `+ - * / ( )`, decimals, `$`, thousands commas, `%`, and numeric `k`/`m`/`b`
// suffixes — no functions, no exponentiation. Bound references
// `@(name#note-id#formula-id)` are factors whose value the caller resolves.
//
// A recursive-descent parser over a hand tokenizer rather than any eval: the
// grammar is closed, and "not executable" is a NORMAL answer (it is what makes
// a pill symbolic), so parse failure carries no error object — just null.

export type BoundRef = {
  name: string;
  noteId: string;
  formulaId: string;
};

type Token =
  | { kind: "number"; value: number }
  | { kind: "op"; op: "+" | "-" | "*" | "/" | "(" | ")" }
  | { kind: "ref"; ref: BoundRef };

export type ExpressionNode =
  | { kind: "number"; value: number }
  | { kind: "ref"; ref: BoundRef }
  | { kind: "negate"; operand: ExpressionNode }
  | { kind: "binary"; op: "+" | "-" | "*" | "/"; left: ExpressionNode; right: ExpressionNode };

const REF_RE = /^@\(([A-Za-z][A-Za-z0-9_-]*)#([^#()\s]+)#([^#()\s]+)\)/u;
// Optional $, digits with optional well-formed thousands groups, optional
// decimals, then at most one of %/k/m/b. A malformed comma run is not a
// number, which makes the whole expression symbolic rather than half-parsed.
const NUMBER_RE = /^\$?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?([%kmb])?/u;

function tokenize(source: string): Token[] | null {
  const tokens: Token[] = [];
  let rest = source;
  for (;;) {
    rest = rest.replace(/^\s+/u, "");
    if (rest === "") break;
    const ref = REF_RE.exec(rest);
    if (ref !== null) {
      const [whole, name, noteId, formulaId] = ref;
      if (name === undefined || noteId === undefined || formulaId === undefined) return null;
      tokens.push({ kind: "ref", ref: { formulaId, name, noteId } });
      rest = rest.slice(whole.length);
      continue;
    }
    const number = NUMBER_RE.exec(rest);
    if (number !== null) {
      const [whole, integer, decimals, suffix] = number;
      const base = Number.parseFloat(`${(integer ?? "").replaceAll(",", "")}${decimals ?? ""}`);
      const scaled =
        suffix === "%"
          ? base / 100
          : suffix === "k"
            ? base * 1e3
            : suffix === "m"
              ? base * 1e6
              : suffix === "b"
                ? base * 1e9
                : base;
      tokens.push({ kind: "number", value: scaled });
      rest = rest.slice(whole.length);
      continue;
    }
    const op = rest[0];
    if (op === "+" || op === "-" || op === "*" || op === "/" || op === "(" || op === ")") {
      tokens.push({ kind: "op", op });
      rest = rest.slice(1);
      continue;
    }
    return null;
  }
  return tokens.length === 0 ? null : tokens;
}

/** Parse `source` into an expression tree, or null when it is not executable
 * (which is the symbolic-variable answer, not an error). */
export function parseExpression(source: string): ExpressionNode | null {
  const tokens = tokenize(source);
  if (tokens === null) return null;
  let position = 0;

  const peek = (): Token | undefined => tokens[position];

  function parseFactor(): ExpressionNode | null {
    const token = peek();
    if (token === undefined) return null;
    if (token.kind === "number") {
      position += 1;
      return { kind: "number", value: token.value };
    }
    if (token.kind === "ref") {
      position += 1;
      return { kind: "ref", ref: token.ref };
    }
    if (token.kind === "op" && token.op === "-") {
      position += 1;
      const operand = parseFactor();
      return operand === null ? null : { kind: "negate", operand };
    }
    if (token.kind === "op" && token.op === "(") {
      position += 1;
      const inner = parseSum();
      const close = peek();
      if (inner === null || close === undefined || close.kind !== "op" || close.op !== ")") {
        return null;
      }
      position += 1;
      return inner;
    }
    return null;
  }

  function parseProduct(): ExpressionNode | null {
    let left = parseFactor();
    for (;;) {
      if (left === null) return null;
      const token = peek();
      if (token === undefined || token.kind !== "op" || (token.op !== "*" && token.op !== "/")) {
        return left;
      }
      position += 1;
      const right = parseFactor();
      if (right === null) return null;
      left = { kind: "binary", left, op: token.op, right };
    }
  }

  function parseSum(): ExpressionNode | null {
    let left = parseProduct();
    for (;;) {
      if (left === null) return null;
      const token = peek();
      if (token === undefined || token.kind !== "op" || (token.op !== "+" && token.op !== "-")) {
        return left;
      }
      position += 1;
      const right = parseProduct();
      if (right === null) return null;
      left = { kind: "binary", left, op: token.op, right };
    }
  }

  const tree = parseSum();
  return tree !== null && position === tokens.length ? tree : null;
}

export function collectBoundRefs(node: ExpressionNode, into: BoundRef[] = []): BoundRef[] {
  switch (node.kind) {
    case "number":
      return into;
    case "ref":
      into.push(node.ref);
      return into;
    case "negate":
      return collectBoundRefs(node.operand, into);
    case "binary":
      collectBoundRefs(node.left, into);
      return collectBoundRefs(node.right, into);
  }
}

export type EvaluateOutcome =
  | { ok: true; value: number }
  | { ok: false; reason: "missing-ref" | "not-finite" };

/** Evaluate a parsed expression. `resolveRef` answers a referenced variable's
 * numeric value, or null when it is missing, cyclic or non-numeric — every
 * such miss makes the whole expression stale rather than half-computed. */
export function evaluateExpression(
  node: ExpressionNode,
  resolveRef: (ref: BoundRef) => number | null,
): EvaluateOutcome {
  const result = walk(node);
  if (result === null) return { ok: false, reason: "missing-ref" };
  if (!Number.isFinite(result)) return { ok: false, reason: "not-finite" };
  return { ok: true, value: result };

  function walk(current: ExpressionNode): number | null {
    switch (current.kind) {
      case "number":
        return current.value;
      case "ref":
        return resolveRef(current.ref);
      case "negate": {
        const operand = walk(current.operand);
        return operand === null ? null : -operand;
      }
      case "binary": {
        const left = walk(current.left);
        const right = walk(current.right);
        if (left === null || right === null) return null;
        switch (current.op) {
          case "+":
            return left + right;
          case "-":
            return left - right;
          case "*":
            return left * right;
          case "/":
            return left / right;
        }
      }
    }
  }
}
