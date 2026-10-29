// The zip codec over its own output and over another writer's: what the writer streams, entry by
// entry and then the directory from their records, reads back file for file, ZIP64's end records
// included once the files pass what a plain zip counts; a zip Python's zipfile wrote reads as it
// was written; and what a stranger's zip may hold that a library must not take is refused or left
// out.

import { describe, expect, it } from "vitest";

import { zipFiles } from "../test-support/library-files";
import { readZipEntries, readZipEntry, ZipError } from "./zip-read";
import type { ByteSource } from "./zip-read";
import type { ZipFile } from "./zip-write";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const sourceOf = (bytes: Uint8Array): ByteSource => ({
  read: async (offset, length) => await Promise.resolve(bytes.slice(offset, offset + length)),
  size: bytes.length,
});

const textFile = (path: string, text: string, deflate = true): ZipFile => ({
  deflate,
  modified: new Date(Date.UTC(2026, 9, 1, 12, 30, 0)),
  open: async () => await Promise.resolve(new Blob([encoder.encode(text)]).stream()),
  path,
});

const contents = async (bytes: Uint8Array): Promise<Record<string, string>> => {
  const source = sourceOf(bytes);
  const entries = await readZipEntries(source);
  const read: Record<string, string> = {};
  for (const entry of entries) {
    read[entry.path] = decoder.decode(await readZipEntry(source, entry, 1024 * 1024));
  }
  return read;
};

// a Python 3 zipfile of `Notes/Café.md` deflated, a folder entry, and `stored.txt` stored
const PYTHON_ZIP =
  "UEsDBBQAAAgIABqoXF3JAHJCLAAAAHgAAAAOAAAATm90ZXMvQ2Fmw6kubWRTVnBOTDu8kovLUSEvvyRVobwos6QkNU8hqVIhESiQkVqkkFhQoMelTGV1AFBLAwQUAAAACAAaqFxdAAAAAAIAAAAAAAAABgAAAE5vdGVzLwMAUEsDBBQAAAAAAAAAIQBleNFaDwAAAA8AAAAKAAAAc3RvcmVkLnR4dHN0b3JlZCBhcyBpdCBpc1BLAQIUAxQAAAgIABqoXF3JAHJCLAAAAHgAAAAOAAAAAAAAAAAAAACAAQAAAABOb3Rlcy9DYWbDqS5tZFBLAQIUAxQAAAAIABqoXF0AAAAAAgAAAAAAAAAGAAAAAAAAAAAAEAD9QVgAAABOb3Rlcy9QSwECFAMUAAAAAAAAACEAZXjRWg8AAAAPAAAACgAAAAAAAAAAAAAAgAF+AAAAc3RvcmVkLnR4dFBLBQYAAAAAAwADAKgAAAC1AAAAAAA=";

// a Python 3 zipfile whose one entry is named `../evil.txt`
const CLIMBING_ZIP =
  "UEsDBBQAAAAAABqoXF0OHyZLDgAAAA4AAAALAAAALi4vZXZpbC50eHRvdXQgb2YgdGhlIHppcFBLAQIUAxQAAAAAABqoXF0OHyZLDgAAAA4AAAALAAAAAAAAAAAAAACAAQAAAAAuLi9ldmlsLnR4dFBLBQYAAAAAAQABADkAAAA3AAAAAAA=";

const fromBase64 = (text: string): Uint8Array =>
  Uint8Array.from(atob(text), (char) => char.codePointAt(0) ?? 0);

// the one entry a zip of one file lists
const onlyEntry = async (source: ByteSource) => {
  const [entry] = await readZipEntries(source);
  if (entry === undefined) {
    throw new Error("the zip listed no entry");
  }
  return entry;
};

describe("a zip this writer streams", () => {
  it("reads back file for file, deflated or stored, its UTF-8 names whole", async () => {
    const bytes = await zipFiles([
      textFile("Notes/Café.md", "# Café\n\nDeflated, and read back.\n".repeat(50)),
      textFile("assets/raw.bin", "stored as it is", false),
      textFile("empty.md", ""),
    ]);
    expect(await contents(bytes)).toEqual({
      "Notes/Café.md": "# Café\n\nDeflated, and read back.\n".repeat(50),
      "assets/raw.bin": "stored as it is",
      "empty.md": "",
    });
  });

  it("writes ZIP64's end records once its files pass 65,534, and reads them back", async () => {
    const files = Array.from({ length: 65_536 }, (_, index) =>
      textFile(`f/${String(index)}.txt`, String(index), false),
    );
    const bytes = await zipFiles(files);
    const entries = await readZipEntries(sourceOf(bytes));
    expect(entries).toHaveLength(65_536);
    expect(entries.at(-1)?.path).toBe("f/65535.txt");
  }, 60_000);

  it("refuses an entry whose bytes do not match its CRC", async () => {
    const bytes = await zipFiles([textFile("note.md", "the bytes as written", false)]);
    const source = sourceOf(bytes);
    const entry = await onlyEntry(source);
    // the stored bytes follow the 30-byte local header and the name
    const at = 30 + "note.md".length;
    bytes[at] = 255 - (bytes[at] ?? 0);
    await expect(readZipEntry(source, entry, 1024)).rejects.toBeInstanceOf(ZipError);
  });

  it("refuses an entry its directory says is encrypted", async () => {
    const bytes = await zipFiles([textFile("secret.md", "hidden")]);
    const source = sourceOf(bytes);
    const plain = await onlyEntry(source);
    expect(plain.encrypted).toBe(false);
    // the general purpose flags of the directory's one entry, whose low bit says encrypted
    const flags = bytes.length - 22 - (46 + "secret.md".length) + 8;
    bytes[flags] = (bytes[flags] ?? 0) + 1;
    const entry = await onlyEntry(source);
    expect(entry.encrypted).toBe(true);
    await expect(readZipEntry(source, entry, 1024)).rejects.toMatchObject({
      fault: "encrypted",
    });
  });
});

describe("a zip another writer made", () => {
  it("reads as Python's zipfile wrote it, its folder entry left out", async () => {
    expect(await contents(fromBase64(PYTHON_ZIP))).toEqual({
      "Notes/Café.md": "# Café\n\nA note written by another app.\n".repeat(3),
      "stored.txt": "stored as it is",
    });
  });

  it("leaves out a name that climbs out of the zip", async () => {
    expect(await readZipEntries(sourceOf(fromBase64(CLIMBING_ZIP)))).toEqual([]);
  });

  it("is refused when it is no zip at all", async () => {
    await expect(
      readZipEntries(sourceOf(encoder.encode("a CSV, not a zip"))),
    ).rejects.toMatchObject({
      fault: "not-a-zip",
    });
  });
});
