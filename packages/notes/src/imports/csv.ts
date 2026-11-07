// RFC 4180, read as exports in the wild are written: a byte-order mark is skipped, a record may end
// in CR, LF or CRLF, a quoted field may hold any of them and "" for a quote, and a quote inside an
// unquoted field is a literal character. A blank line is no record. Pure: the bytes are hostile and
// nothing here reads them from anywhere.

export type CsvParse =
  | { ok: true; records: string[][] }
  // the quoted field that never closed, and the record (1 is the first) it opened in
  | { ok: false; record: number; reason: "unterminated-quote" };

const QUOTE = '"';

export const parseCsv = (text: string): CsvParse => {
  const source = text.startsWith("﻿") ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  // a record holds something once a field was quoted or a separator or character was read
  let started = false;
  let index = 0;
  const endRecord = (): void => {
    if (started) {
      record.push(field);
      records.push(record);
    }
    record = [];
    field = "";
    started = false;
  };
  while (index < source.length) {
    const character = source[index];
    if (character === QUOTE && field === "") {
      const opened = records.length + 1;
      index += 1;
      let closed = false;
      while (index < source.length) {
        const inner = source[index];
        if (inner === QUOTE) {
          if (source[index + 1] === QUOTE) {
            field += QUOTE;
            index += 2;
            continue;
          }
          index += 1;
          closed = true;
          break;
        }
        field += inner;
        index += 1;
      }
      if (!closed) {
        return { ok: false, reason: "unterminated-quote", record: opened };
      }
      started = true;
      continue;
    }
    if (character === ",") {
      record.push(field);
      field = "";
      started = true;
      index += 1;
      continue;
    }
    if (character === "\r" || character === "\n") {
      endRecord();
      index += character === "\r" && source[index + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += character;
    started = true;
    index += 1;
  }
  endRecord();
  return { ok: true, records };
};
