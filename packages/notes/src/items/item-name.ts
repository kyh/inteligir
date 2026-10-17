// What a saved item is called. The filename is its title, so a page's title becomes a legal note
// name here, once, for every writer: the Mac's save and fill, the phone's share and the import.
// Unlike a name the person types (checkNoteName refuses), a page's title is repaired.

import { urlHost } from "./item-url";

const NAME_MAX_CHARS = 120;

// a name's bytes leave room for a clash's ` 99` and the doc extension under 255
const NAME_MAX_BYTES = 240;

const DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu;

const DEVICE_SUFFIX = " (item)";

const EDGES = /^[\s.-]+|[\s.-]+$/gu;

const isControl = (cp: number): boolean => cp < 0x20 || (cp >= 0x7f && cp <= 0x9f);

const DROPPED = new Set(["*", "?", "<", ">"]);

// rules 2–6: every character a title may not carry as written, replaced or dropped
const repairChars = (text: string): string => {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (/\s/u.test(ch)) {
      out += " ";
    } else if (ch === ":" || ch === "|") {
      out += " - ";
    } else if (ch === "/" || ch === "\\") {
      out += "-";
    } else if (ch === "[") {
      out += "(";
    } else if (ch === "]") {
      out += ")";
    } else if (ch === '"') {
      out += "'";
    } else if (!DROPPED.has(ch) && !isControl(cp)) {
      out += ch;
    }
  }
  return out;
};

// not TextEncoder: hermes (react native) only recently grew it
const utf8Length = (ch: string): number => {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp <= 0x7f) {
    return 1;
  }
  if (cp <= 0x7_ff) {
    return 2;
  }
  return cp <= 0xff_ff ? 3 : 4;
};

// the longest prefix within both budgets, cut back to its last space when one is in it
const cutAtWord = (name: string, maxChars: number, maxBytes: number): string => {
  const chars = [...name];
  let bytes = 0;
  let fits = 0;
  while (fits < chars.length && fits < maxChars) {
    bytes += utf8Length(chars[fits] ?? "");
    if (bytes > maxBytes) {
      break;
    }
    fits += 1;
  }
  if (fits === chars.length) {
    return name;
  }
  const head = chars.slice(0, fits);
  const space = chars[fits] === " " ? fits : head.lastIndexOf(" ");
  return (space > 0 ? head.slice(0, space) : head).join("").replaceAll(EDGES, "");
};

// Windows reserves a device name before the first dot (`con.tar` too), so the suffix goes there
const deviceStemEnd = (name: string): number | null => {
  const dot = name.indexOf(".");
  const stem = (dot === -1 ? name : name.slice(0, dot)).trimEnd();
  return DEVICE_NAME.test(stem) ? stem.length : null;
};

// a page title as a note name, or null when nothing printable is left
export const itemNameFromTitle = (title: string): string | null => {
  const clean = repairChars(title.normalize("NFC")).replaceAll(/ +/gu, " ").replaceAll(EDGES, "");
  if (clean === "") {
    return null;
  }
  const name = cutAtWord(clean, NAME_MAX_CHARS, NAME_MAX_BYTES);
  if (deviceStemEnd(name) === null) {
    return name;
  }
  const room = cutAtWord(
    clean,
    NAME_MAX_CHARS - DEVICE_SUFFIX.length,
    NAME_MAX_BYTES - DEVICE_SUFFIX.length,
  );
  const end = deviceStemEnd(room);
  return end === null ? room : `${room.slice(0, end)}${DEVICE_SUFFIX}${room.slice(end)}`;
};

const safeDecode = (text: string): string => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

// a path segment read as words: decoded, `-` and `_` as spaces, its extension dropped
const humanizeSegment = (segment: string): string => {
  const decoded = safeDecode(segment);
  const dot = decoded.lastIndexOf(".");
  return (dot > 0 ? decoded.slice(0, dot) : decoded).replaceAll(/[-_]+/gu, " ").trim();
};

const lastPathSegment = (url: string): string => {
  const path = /^[^:]+:\/\/[^/?#]*(?<path>[^?#]*)/u.exec(url.trim())?.groups?.["path"] ?? "";
  return path.split("/").findLast((segment) => segment !== "") ?? "";
};

const UNTITLED = "Untitled";

// `<host> - <its last path segment, humanized>`, or the host alone
export const itemNameFromUrl = (url: string): string => {
  const host = urlHost(url);
  if (host === null) {
    return itemNameFromTitle(url) ?? UNTITLED;
  }
  const words = humanizeSegment(lastPathSegment(url));
  const named = words === "" ? null : itemNameFromTitle(`${host} - ${words}`);
  return named ?? itemNameFromTitle(host) ?? UNTITLED;
};

export const itemStem = (title: string | null, url: string | null): string =>
  (title === null ? null : itemNameFromTitle(title)) ??
  (url === null ? UNTITLED : itemNameFromUrl(url));
