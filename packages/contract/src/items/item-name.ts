// What an item is called as a name: the file an export writes its title to, and the title a saved
// address goes by until its page is read. A title becomes a legal file name here, once, for every
// writer, repaired rather than refused, so each name is one every disk takes and a link can name.

import { utf8ByteLength } from "../library/canonical-json";
import { safeDecode } from "../text/safe-decode";
import { extensionsOfType } from "./item-kind";
import type { SniffedMedia } from "./sniff-media";
import { urlHost, urlLastSegment } from "./item-url";

const NAME_MAX_CHARS = 120;

// a name's bytes leave room for a clash's ` 99` and the doc extension under 255
const NAME_MAX_BYTES = 240;

const DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu;

const DEVICE_SUFFIX = " (item)";

const EDGES = /^[\s.-]+|[\s.-]+$/gu;

const isControl = (cp: number): boolean => cp < 0x20 || (cp >= 0x7f && cp <= 0x9f);

const DROPPED = new Set(["*", "?", "<", ">"]);

// every character a title may not carry as written, replaced or dropped
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

// the longest prefix within both budgets, cut back to its last space when one is in it
const cutAtWord = (name: string, maxChars: number, maxBytes: number): string => {
  const chars = [...name];
  let bytes = 0;
  let fits = 0;
  while (fits < chars.length && fits < maxChars) {
    bytes += utf8ByteLength(chars[fits] ?? "");
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

// a path segment read as words: decoded, `-` and `_` as spaces, its extension dropped
const humanizeSegment = (segment: string): string => {
  const decoded = safeDecode(segment);
  const dot = decoded.lastIndexOf(".");
  return (dot > 0 ? decoded.slice(0, dot) : decoded).replaceAll(/[-_]+/gu, " ").trim();
};

const lastPathSegment = (url: string): string => {
  const path = /^[^:]+:\/\/[^/?#]*(?<path>[^?#]*)/u.exec(url.trim())?.groups?.path ?? "";
  return path.split("/").findLast((segment) => segment !== "") ?? "";
};

export const UNTITLED = "Untitled";

// a title as a surface draws it: an item with no name and no words still has a row to fill
export const shownTitle = (title: string): string => (title === "" ? UNTITLED : title);

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

// a file found at a link keeps its own name when the address names one with the right extension
export const originalFileName = (url: string, mediaType: SniffedMedia["mediaType"]): string => {
  const extensions = extensionsOfType(mediaType);
  const segment = urlLastSegment(url);
  const dot = segment.lastIndexOf(".");
  const stem = itemNameFromTitle(dot > 0 ? segment.slice(0, dot) : segment) ?? "File";
  const given = dot > 0 ? segment.slice(dot + 1).toLowerCase() : "";
  const extension = extensions.includes(given) ? given : extensions[0];
  return extension === undefined ? stem : `${stem}.${extension}`;
};
