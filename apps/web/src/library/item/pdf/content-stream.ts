import {
  CLOSE_BRACKET,
  DELIMITERS,
  GREATER,
  LESS,
  Lexer,
  OPEN_BRACKET,
  OPEN_PAREN,
  SLASH,
} from "./content-lexer";

export type Operand =
  | { readonly kind: "array"; readonly items: readonly Operand[] }
  | { readonly kind: "name"; readonly value: string }
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "other" }
  | { readonly kind: "string"; readonly bytes: Uint8Array };

export interface Operation {
  readonly end: number;
  readonly operands: readonly Operand[];
  readonly operator: string;
  readonly start: number;
}

type Frame =
  | { readonly kind: "array"; readonly items: Operand[] }
  | { readonly kind: "dict"; depth: number };

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/u;

const KEYWORD_OPERANDS = new Set(["true", "false", "null"]);

class Parser {
  readonly operations: Operation[] = [];
  private operands: Operand[] = [];
  private operandsStart = -1;
  private readonly frames: Frame[] = [];
  private readonly lexer: Lexer;

  constructor(bytes: Uint8Array) {
    this.lexer = new Lexer(bytes);
  }

  run() {
    this.lexer.skipSpace();

    while (!this.lexer.done()) {
      this.step(this.lexer.position);
      this.lexer.skipSpace();
    }

    return this.operations;
  }

  private mark(start: number) {
    if (this.frames.length === 0 && this.operandsStart === -1) {
      this.operandsStart = start;
    }
  }

  private push(operand: Operand, start: number) {
    const frame = this.frames.at(-1);

    if (frame === undefined) {
      this.mark(start);
      this.operands.push(operand);
    } else if (frame.kind === "array") {
      frame.items.push(operand);
    }
  }

  private step(start: number) {
    const { lexer } = this;
    const byte = lexer.at();

    if (byte === OPEN_PAREN) {
      this.push({ bytes: lexer.literalString(), kind: "string" }, start);
    } else if (byte === LESS && lexer.at(1) === LESS) {
      this.openDict(start);
    } else if (byte === GREATER && lexer.at(1) === GREATER) {
      this.closeDict(start);
    } else if (byte === LESS) {
      this.push({ bytes: lexer.hexString(), kind: "string" }, start);
    } else if (byte === OPEN_BRACKET) {
      this.openArray(start);
    } else if (byte === CLOSE_BRACKET) {
      this.closeArray(start);
    } else if (byte === SLASH) {
      this.push({ kind: "name", value: lexer.name() }, start);
    } else if (DELIMITERS.has(byte)) {
      lexer.position += 1;
    } else {
      this.word(start);
    }
  }

  private openDict(start: number) {
    const frame = this.frames.at(-1);
    this.lexer.position += 2;
    this.mark(start);

    if (frame?.kind === "dict") {
      frame.depth += 1;
    } else {
      this.frames.push({ depth: 1, kind: "dict" });
    }
  }

  private closeDict(start: number) {
    const frame = this.frames.at(-1);
    this.lexer.position += 2;

    if (frame?.kind !== "dict") {
      return;
    }

    frame.depth -= 1;

    if (frame.depth === 0) {
      this.frames.pop();
      this.push({ kind: "other" }, start);
    }
  }

  private openArray(start: number) {
    this.lexer.position += 1;

    if (this.frames.at(-1)?.kind !== "dict") {
      this.mark(start);
      this.frames.push({ items: [], kind: "array" });
    }
  }

  private closeArray(start: number) {
    const frame = this.frames.at(-1);
    this.lexer.position += 1;

    if (frame?.kind === "array") {
      this.frames.pop();
      this.push({ items: frame.items, kind: "array" }, start);
    }
  }

  private word(start: number) {
    const word = this.lexer.word();

    if (NUMBER.test(word)) {
      this.push({ kind: "number", value: Number(word) }, start);

      return;
    }

    if (KEYWORD_OPERANDS.has(word) || this.frames.length > 0) {
      this.push({ kind: "other" }, start);

      return;
    }

    if (word === "ID") {
      this.lexer.skipInlineImage();
    }

    this.operations.push({
      end: this.lexer.position,
      operands: this.operands,
      operator: word,
      start: this.operandsStart === -1 ? start : this.operandsStart,
    });
    this.operands = [];
    this.operandsStart = -1;
  }
}

export const readOperations = (bytes: Uint8Array) => new Parser(bytes).run();
