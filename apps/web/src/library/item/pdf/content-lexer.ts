const WHITESPACE = new Set([0, 9, 10, 12, 13, 32]);

const code = (char: string) => char.codePointAt(0) ?? 0;

export const DELIMITERS = new Set(["(", ")", "<", ">", "[", "]", "{", "}", "/", "%"].map(code));

const BACKSLASH = code("\\");
export const OPEN_PAREN = code("(");
const CLOSE_PAREN = code(")");
export const LESS = code("<");
export const GREATER = code(">");
export const OPEN_BRACKET = code("[");
export const CLOSE_BRACKET = code("]");
export const SLASH = code("/");
const PERCENT = code("%");
const HASH = code("#");
const LF = 10;
const CR = 13;

const ESCAPES = new Map([
  [code("n"), LF],
  [code("r"), CR],
  [code("t"), 9],
  [code("b"), 8],
  [code("f"), 12],
]);

const isRegular = (byte: number) => !WHITESPACE.has(byte) && !DELIMITERS.has(byte);

const isDigit = (byte: number) => byte >= code("0") && byte <= code("7");

const hexValue = (byte: number) => {
  const char = String.fromCodePoint(byte);
  const value = Number.parseInt(char, 16);

  return Number.isNaN(value) ? null : value;
};

const latin = (bytes: Uint8Array, start: number, end: number) =>
  String.fromCodePoint(...bytes.subarray(start, end));

export class Lexer {
  position = 0;
  private readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  at(offset = 0) {
    return this.bytes[this.position + offset] ?? -1;
  }

  done() {
    return this.position >= this.bytes.length;
  }

  skipSpace() {
    while (!this.done()) {
      const byte = this.at();

      if (WHITESPACE.has(byte)) {
        this.position += 1;
      } else if (byte === PERCENT) {
        while (!this.done() && this.at() !== LF && this.at() !== CR) {
          this.position += 1;
        }
      } else {
        return;
      }
    }
  }

  literalString() {
    const out: number[] = [];
    let depth = 1;
    this.position += 1;

    while (!this.done()) {
      const byte = this.at();
      this.position += 1;

      if (byte === BACKSLASH) {
        const next = this.at();
        this.position += 1;
        const escaped = ESCAPES.get(next);

        if (escaped !== undefined) {
          out.push(escaped);
        } else if (isDigit(next)) {
          let value = next - code("0");

          for (let more = 0; more < 2 && isDigit(this.at()); more += 1) {
            value = value * 8 + (this.at() - code("0"));
            this.position += 1;
          }

          out.push(value % 256);
        } else if (next === CR) {
          if (this.at() === LF) {
            this.position += 1;
          }
        } else if (next !== LF) {
          out.push(next);
        }
      } else if (byte === OPEN_PAREN) {
        depth += 1;
        out.push(byte);
      } else if (byte === CLOSE_PAREN) {
        depth -= 1;

        if (depth === 0) {
          break;
        }

        out.push(byte);
      } else {
        out.push(byte);
      }
    }

    return Uint8Array.from(out);
  }

  hexString() {
    const digits: number[] = [];
    this.position += 1;

    while (!this.done() && this.at() !== GREATER) {
      const value = hexValue(this.at());

      if (value !== null) {
        digits.push(value);
      }

      this.position += 1;
    }

    this.position += 1;

    if (digits.length % 2 === 1) {
      digits.push(0);
    }

    const out = new Uint8Array(digits.length / 2);

    for (let index = 0; index < out.length; index += 1) {
      out[index] = (digits[index * 2] ?? 0) * 16 + (digits[index * 2 + 1] ?? 0);
    }

    return out;
  }

  name() {
    this.position += 1;
    let value = "";

    while (!this.done() && isRegular(this.at())) {
      const byte = this.at();
      const high = hexValue(this.at(1));
      const low = hexValue(this.at(2));

      if (byte === HASH && high !== null && low !== null) {
        value += String.fromCodePoint(high * 16 + low);
        this.position += 3;
      } else {
        value += String.fromCodePoint(byte);
        this.position += 1;
      }
    }

    return value;
  }

  word() {
    const start = this.position;

    while (!this.done() && isRegular(this.at())) {
      this.position += 1;
    }

    return latin(this.bytes, start, this.position);
  }

  skipInlineImage() {
    this.position += 1;

    while (!this.done()) {
      const ends =
        this.at() === code("E") &&
        this.at(1) === code("I") &&
        WHITESPACE.has(this.at(-1)) &&
        (this.at(2) === -1 || WHITESPACE.has(this.at(2)));

      if (ends) {
        return;
      }

      this.position += 1;
    }
  }
}
