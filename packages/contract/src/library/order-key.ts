import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";

const ORD_MAX_LENGTH = 128;

const BASE_62_KEY = /^[0-9A-Za-z]+$/u;
const NEGATIVE_HEADS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const POSITIVE_HEADS = "abcdefghijklmnopqrstuvwxyz";
const HEAD_COUNT = 26;
const SHORTEST_INTEGER = 2;
const SMALLEST_KEY = `A${"0".repeat(HEAD_COUNT)}`;

const integerLength = (head: string) => {
  const positive = POSITIVE_HEADS.indexOf(head);

  if (positive !== -1) {
    return positive + SHORTEST_INTEGER;
  }

  const negative = NEGATIVE_HEADS.indexOf(head);

  return negative === -1 ? null : HEAD_COUNT - negative + 1;
};

export const isOrdKey = (key: string) => {
  if (key.length === 0 || key.length > ORD_MAX_LENGTH || key === SMALLEST_KEY) {
    return false;
  }

  const length = integerLength(key.slice(0, 1));

  if (length === null || length > key.length) {
    return false;
  }

  if (key.length > length && key.endsWith("0")) {
    return false;
  }

  return BASE_62_KEY.test(key);
};

export const ordSchema = z.string().refine(isOrdKey, { error: "is not an order key" });

export const ordBetween = (before: string | null, after: string | null) =>
  generateKeyBetween(before, after);

export const compareText = (a: string, b: string) => {
  if (a === b) {
    return 0;
  }

  const shared = Math.min(a.length, b.length);
  let at = 0;

  while (at < shared && a[at] === b[at]) {
    at += 1;
  }

  if (at === shared) {
    return a.length < b.length ? -1 : 1;
  }

  return (a.codePointAt(at) ?? 0) < (b.codePointAt(at) ?? 0) ? -1 : 1;
};
