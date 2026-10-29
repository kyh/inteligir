import { describe, expect, it } from "vitest";

import { mulberry32 } from "../test-support/seeded-random";
import { parseCsv } from "./csv";

const records = (text: string): string[][] => {
  const parsed = parseCsv(text);
  if (!parsed.ok) {
    throw new Error(`record ${String(parsed.record)}: ${parsed.reason}`);
  }
  return parsed.records;
};

const quoted = (value: string): string => `"${value.replaceAll('"', '""')}"`;

describe("parseCsv", () => {
  it("reads fields and records, with or without a final line break", () => {
    expect(records("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
    expect(records("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("ends a record at CRLF, LF or CR, and skips a byte-order mark", () => {
    expect(records("﻿a,b\r\n1,2\r3,4\n5,6")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
      ["5", "6"],
    ]);
  });

  it("reads a quoted field's commas, line breaks and doubled quotes", () => {
    expect(records('title,note\n"Hello, world","line one\r\nline ""two"""\n')).toEqual([
      ["title", "note"],
      ["Hello, world", 'line one\r\nline "two"'],
    ]);
  });

  it("keeps empty fields, and a quoted empty field", () => {
    expect(records('a,,c\n,"",\n')).toEqual([
      ["a", "", "c"],
      ["", "", ""],
    ]);
  });

  it("skips a blank line", () => {
    expect(records("a\n\n\nb\n")).toEqual([["a"], ["b"]]);
  });

  it("reads a quote inside an unquoted field as a character", () => {
    expect(records('say "hi",x\n')).toEqual([['say "hi"', "x"]]);
  });

  it("refuses a quote that never closes, naming its record", () => {
    expect(parseCsv('a,b\n1,"open\n2,3\n')).toEqual({
      ok: false,
      reason: "unterminated-quote",
      record: 2,
    });
  });

  it("round-trips a random matrix written as RFC 4180", () => {
    const random = mulberry32(4180);
    const alphabet = ["a", "b", " ", ",", '"', "\n", "\r\n", "é", "x"];
    const cell = (): string =>
      Array.from(
        { length: Math.floor(random() * 6) },
        () => alphabet[Math.floor(random() * alphabet.length)],
      ).join("");
    for (let run = 0; run < 200; run += 1) {
      const width = 1 + Math.floor(random() * 5);
      const matrix = Array.from({ length: 1 + Math.floor(random() * 6) }, () =>
        Array.from({ length: width }, cell),
      );
      const text = matrix
        .map((row) =>
          row
            .map((value) =>
              random() < 0.5 && !/[",\r\n]/u.test(value) && value !== "" ? value : quoted(value),
            )
            .join(","),
        )
        .join(random() < 0.5 ? "\n" : "\r\n");
      expect(records(text)).toEqual(matrix);
    }
  });
});
