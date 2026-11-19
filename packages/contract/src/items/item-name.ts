import { utf8ByteLength } from "../library/canonical-json";
import { extensionsOfType } from "./item-kind";
import type { SniffedMedia } from "./sniff-media";
import { urlHost, urlLastSegment } from "./item-url";

const NAME_MAX_CHARS = 120;

const NAME_MAX_BYTES = 240;

const DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu;

const DEVICE_SUFFIX = " (item)";

const EDGES = /^[\s.-]+|[\s.-]+$/gu;

const isControl = (cp: number) => cp < 0x20 || (cp >= 0x7f && cp <= 0x9f);

const DROPPED = new Set(["*", "?", "<", ">"]);

const repairChars = (text: string) => {
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

const cutAtWord = (name: string, maxChars: number, maxBytes: number) => {
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

const deviceStemEnd = (name: string) => {
  const dot = name.indexOf(".");
  const stem = (dot === -1 ? name : name.slice(0, dot)).trimEnd();

  return DEVICE_NAME.test(stem) ? stem.length : null;
};

export const itemNameFromTitle = (title: string) => {
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

const humanizeSegment = (segment: string) => {
  const dot = segment.lastIndexOf(".");

  return (dot > 0 ? segment.slice(0, dot) : segment).replaceAll(/[-_]+/gu, " ").trim();
};

export const UNTITLED = "Untitled";

export const shownTitle = (title: string) => (title === "" ? UNTITLED : title);

export const itemNameFromUrl = (url: string) => {
  const host = urlHost(url);

  if (host === null) {
    return itemNameFromTitle(url) ?? UNTITLED;
  }

  const words = humanizeSegment(urlLastSegment(url));
  const named = words === "" ? null : itemNameFromTitle(`${host} - ${words}`);

  return named ?? itemNameFromTitle(host) ?? UNTITLED;
};

export const originalFileName = (url: string, mediaType: SniffedMedia["mediaType"]) => {
  const extensions = extensionsOfType(mediaType);
  const segment = urlLastSegment(url);
  const dot = segment.lastIndexOf(".");
  const stem = itemNameFromTitle(dot > 0 ? segment.slice(0, dot) : segment) ?? "File";
  const given = dot > 0 ? segment.slice(dot + 1).toLowerCase() : "";
  const extension = extensions.includes(given) ? given : extensions[0];

  return extension === undefined ? stem : `${stem}.${extension}`;
};
