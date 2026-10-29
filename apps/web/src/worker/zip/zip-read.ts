// A zip read where it lies, a range at a time (APPNOTE.TXT): the end of the central directory found
// from the file's tail (§ 4.3.16), its ZIP64 records followed where they stand in (§ 4.3.14,
// § 4.3.15), every entry listed from the directory rather than the local headers, so a file the
// directory names is reached at once and a job can resume at any entry; each file's bytes are
// inflated by the platform's own DecompressionStream or read as stored, and held to the CRC and size
// the directory gives. An encrypted entry, a method other than store or deflate, and a name that
// climbs out of the zip are refused: the bytes are a stranger's.

import { normalizePath } from "@repo/notes/knowledge/vault-path";

import { crc32 } from "./crc32";

// the zip's bytes by offset, wherever they live (an R2 object's ranges)
export interface ByteSource {
  readonly size: number;
  readonly read: (offset: number, length: number) => Promise<Uint8Array>;
}

export interface ZipEntry {
  // its place among the directory's entries
  readonly index: number;
  // its path inside the zip, normalized, `/` between folders
  readonly path: string;
  readonly method: number;
  readonly encrypted: boolean;
  readonly crc: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly headerOffset: number;
}

export type ZipFault = "not-a-zip" | "corrupt" | "encrypted" | "method" | "too-large";

export class ZipError extends Error {
  readonly fault: ZipFault;

  constructor(fault: ZipFault, message: string) {
    super(message);
    this.name = "ZipError";
    this.fault = fault;
  }
}

const LOCAL_HEADER = 0x04_03_4b_50;
const CENTRAL_HEADER = 0x02_01_4b_50;
const END_OF_DIRECTORY = 0x06_05_4b_50;
const ZIP64_END_OF_DIRECTORY = 0x06_06_4b_50;
const ZIP64_LOCATOR = 0x07_06_4b_50;
const ZIP64_EXTRA = 0x00_01;

const STORED = 0;
const DEFLATED = 8;
const U16_MAX = 0xff_ff;
const U32_MAX = 0xff_ff_ff_ff;

const END_LENGTH = 22;
const LOCATOR_LENGTH = 20;
const ZIP64_END_LENGTH = 56;
// the end record's comment runs up to 65,535 bytes, so the record lies within this many of the end
const TAIL_MAX = END_LENGTH + U16_MAX;

// a directory past these is no library a person zipped
const DIRECTORY_MAX_BYTES = 64 * 1024 * 1024;
const ENTRIES_MAX = 500_000;

// the bytes a stream of one entry reads at a time
const READ_STEP = 1024 * 1024;

const view = (bytes: Uint8Array): DataView =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

const u16 = (data: DataView, at: number): number => data.getUint16(at, true);
const u32 = (data: DataView, at: number): number => data.getUint32(at, true);

const u64 = (data: DataView, at: number): number => {
  const value = data.getBigUint64(at, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ZipError("corrupt", "a ZIP64 field names an offset past any file");
  }
  return Number(value);
};

const corrupt = (message: string): ZipError => new ZipError("corrupt", message);

const decoder = new TextDecoder();

interface Directory {
  readonly count: number;
  readonly size: number;
  readonly offset: number;
}

const findEnd = (tail: DataView): number | null => {
  for (let at = tail.byteLength - END_LENGTH; at >= 0; at -= 1) {
    if (
      u32(tail, at) === END_OF_DIRECTORY &&
      at + END_LENGTH + u16(tail, at + 20) === tail.byteLength
    ) {
      return at;
    }
  }
  return null;
};

const directoryOf = async (source: ByteSource): Promise<Directory> => {
  const tailLength = Math.min(source.size, TAIL_MAX + LOCATOR_LENGTH);
  const tailStart = source.size - tailLength;
  const tail = view(await source.read(tailStart, tailLength));
  const end = findEnd(tail);
  if (end === null) {
    throw new ZipError("not-a-zip", "the file has no zip directory at its end");
  }
  const count = u16(tail, end + 10);
  const size = u32(tail, end + 12);
  const offset = u32(tail, end + 16);
  const locatorAt = end - LOCATOR_LENGTH;
  const zip64 = locatorAt >= 0 && u32(tail, locatorAt) === ZIP64_LOCATOR;
  if (!zip64) {
    if (count === U16_MAX || size === U32_MAX || offset === U32_MAX) {
      throw corrupt("the directory's end names ZIP64 fields but no ZIP64 record");
    }
    return { count, offset, size };
  }
  const record = view(await source.read(u64(tail, locatorAt + 8), ZIP64_END_LENGTH));
  if (u32(record, 0) !== ZIP64_END_OF_DIRECTORY) {
    throw corrupt("the ZIP64 locator points at no ZIP64 end record");
  }
  return { count: u64(record, 32), offset: u64(record, 48), size: u64(record, 40) };
};

// a name as the zip's own: UTF-8, which every current writer uses whether or not it sets the flag,
// its separators forward, and refused when it climbs out of the zip or names nothing
const pathOf = (name: Uint8Array): string | null => {
  const path = normalizePath(decoder.decode(name).replaceAll("\\", "/"));
  return path === "" || path === ".." || path.startsWith("../") ? null : path;
};

interface Sizes {
  size: number;
  compressedSize: number;
  headerOffset: number;
}

// the ZIP64 extra's eight-byte values, each present only where its field was 0xFFFFFFFF
const zip64Sizes = (extra: DataView, sizes: Sizes): Sizes => {
  for (let at = 0; at + 4 <= extra.byteLength;) {
    const id = u16(extra, at);
    const length = u16(extra, at + 2);
    if (id === ZIP64_EXTRA) {
      let field = at + 4;
      const next = (): number => {
        if (field + 8 > at + 4 + length) {
          throw corrupt("a ZIP64 extra field is shorter than its sizes");
        }
        const value = u64(extra, field);
        field += 8;
        return value;
      };
      return {
        size: sizes.size === U32_MAX ? next() : sizes.size,
        compressedSize: sizes.compressedSize === U32_MAX ? next() : sizes.compressedSize,
        headerOffset: sizes.headerOffset === U32_MAX ? next() : sizes.headerOffset,
      };
    }
    at += 4 + length;
  }
  return sizes;
};

// every file the zip's directory names, folders left out; null names an entry it refuses to read
export const readZipEntries = async (source: ByteSource): Promise<ZipEntry[]> => {
  const directory = await directoryOf(source);
  if (directory.size > DIRECTORY_MAX_BYTES || directory.count > ENTRIES_MAX) {
    throw new ZipError("too-large", "the zip names more files than a library holds");
  }
  if (directory.offset + directory.size > source.size) {
    throw corrupt("the directory runs past the end of the file");
  }
  const bytes = await source.read(directory.offset, directory.size);
  const data = view(bytes);
  const entries: ZipEntry[] = [];
  let at = 0;
  for (let index = 0; index < directory.count; index += 1) {
    if (at + 46 > data.byteLength || u32(data, at) !== CENTRAL_HEADER) {
      throw corrupt("the directory holds fewer entries than it says");
    }
    const nameLength = u16(data, at + 28);
    const extraLength = u16(data, at + 30);
    const commentLength = u16(data, at + 32);
    const name = bytes.subarray(at + 46, at + 46 + nameLength);
    const extra = view(bytes.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength));
    const sizes = zip64Sizes(extra, {
      compressedSize: u32(data, at + 20),
      headerOffset: u32(data, at + 42),
      size: u32(data, at + 24),
    });
    const path = pathOf(name);
    // a folder's own entry names no file
    if (path !== null && !decoder.decode(name).endsWith("/")) {
      entries.push({
        ...sizes,
        crc: u32(data, at + 16),
        encrypted: u16(data, at + 8) % 2 === 1,
        index,
        method: u16(data, at + 10),
        path,
      });
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
};

// where the entry's bytes begin, past its local header, whose name and extra may differ in length
// from the directory's
const dataOffset = async (source: ByteSource, entry: ZipEntry): Promise<number> => {
  const header = view(await source.read(entry.headerOffset, 30));
  if (u32(header, 0) !== LOCAL_HEADER) {
    throw corrupt(`${entry.path}'s local header is not where the directory says`);
  }
  return entry.headerOffset + 30 + u16(header, 26) + u16(header, 28);
};

// the entry's stored bytes, a step at a time
const rawStream = (
  source: ByteSource,
  start: number,
  length: number,
): ReadableStream<Uint8Array> => {
  let read = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (read >= length) {
        controller.close();
        return;
      }
      const step = Math.min(READ_STEP, length - read);
      controller.enqueue(await source.read(start + read, step));
      read += step;
    },
  });
};

// the entry's bytes held to what the directory says of them: an inflation past its size (a zip
// bomb), short of it, or with another CRC is refused
const verified = (entry: ZipEntry) => {
  let crc = 0;
  let size = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    flush() {
      if (size !== entry.size || crc !== entry.crc) {
        throw corrupt(`${entry.path}'s bytes do not match its size and CRC`);
      }
    },
    transform(chunk, controller) {
      size += chunk.length;
      if (size > entry.size) {
        throw corrupt(`${entry.path} inflates past the size the zip gives it`);
      }
      crc = crc32(crc, chunk);
      controller.enqueue(chunk);
    },
  });
};

// one file's bytes, inflated and checked as they stream
export const openZipEntry = async (
  source: ByteSource,
  entry: ZipEntry,
): Promise<ReadableStream<Uint8Array>> => {
  if (entry.encrypted) {
    throw new ZipError("encrypted", `${entry.path} is encrypted`);
  }
  if (entry.method !== STORED && entry.method !== DEFLATED) {
    throw new ZipError("method", `${entry.path} is compressed in a way this reader does not know`);
  }
  const start = await dataOffset(source, entry);
  if (start + entry.compressedSize > source.size) {
    throw corrupt(`${entry.path} runs past the end of the file`);
  }
  const raw = rawStream(source, start, entry.compressedSize);
  const plain =
    entry.method === DEFLATED ? raw.pipeThrough(new DecompressionStream("deflate-raw")) : raw;
  return plain.pipeThrough(verified(entry));
};

// one file's bytes whole, for an entry at most `maxBytes`
export const readZipEntry = async (
  source: ByteSource,
  entry: ZipEntry,
  maxBytes: number,
): Promise<Uint8Array> => {
  if (entry.size > maxBytes) {
    throw new ZipError("too-large", `${entry.path} is larger than an item takes`);
  }
  return new Uint8Array(await new Response(await openZipEntry(source, entry)).arrayBuffer());
};
