// A zip written as it streams (APPNOTE.TXT 6.3.10), a file at a time, so a writer may stop between
// any two files and go on later from what it kept: each file opened only when its turn comes, its
// local header first, its bytes deflated through the platform's own CompressionStream or stored as
// they are, and its CRC and sizes after it in a data descriptor (§ 4.3.9), so no file is held whole;
// each file's directory record (`ZipRecord`) is the writer's to keep, and once every file is written
// the central directory is written from them, with the ZIP64 end records (§ 4.3.14, § 4.3.15) once
// the files pass 65,534 or the directory passes 4 GiB of offset. Names are UTF-8 and say so
// (§ 4.4.4, bit 11). A file of 4 GiB or more is refused: the library holds none.

import { crc32 } from "./crc32";

export interface ZipFile {
  // its path inside the zip, `/` between folders
  readonly path: string;
  readonly modified: Date;
  // false for bytes already compressed (a picture, a PDF), which deflate only slows
  readonly deflate: boolean;
  // opened when the writer reaches it
  readonly open: () => Promise<ReadableStream<Uint8Array>>;
}

const LOCAL_HEADER = 0x04_03_4b_50;
const DATA_DESCRIPTOR = 0x08_07_4b_50;
const CENTRAL_HEADER = 0x02_01_4b_50;
const END_OF_DIRECTORY = 0x06_05_4b_50;
const ZIP64_END_OF_DIRECTORY = 0x06_06_4b_50;
const ZIP64_LOCATOR = 0x07_06_4b_50;
const ZIP64_EXTRA = 0x00_01;

// sizes and CRC follow the data, and the name is UTF-8
const FLAGS = 0x00_08 + 0x08_00;
const STORED = 0;
const DEFLATED = 8;
const VERSION = 20;
const VERSION_ZIP64 = 45;
// made by UNIX (3), so an unzip reads no attributes from a field this writer leaves zero
const MADE_BY = 3 * 256 + VERSION_ZIP64;

const U16_MAX = 0xff_ff;
const U32_MAX = 0xff_ff_ff_ff;

const encoder = new TextEncoder();

// little-endian fields into one buffer, as every zip record is laid out
class Record {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly #view: DataView;
  #at = 0;

  constructor(length: number) {
    this.bytes = new Uint8Array(length);
    this.#view = new DataView(this.bytes.buffer);
  }

  u16(value: number): this {
    this.#view.setUint16(this.#at, value, true);
    this.#at += 2;
    return this;
  }

  u32(value: number): this {
    this.#view.setUint32(this.#at, value, true);
    this.#at += 4;
    return this;
  }

  u64(value: number): this {
    this.#view.setBigUint64(this.#at, BigInt(value), true);
    this.#at += 8;
    return this;
  }

  raw(value: Uint8Array): this {
    this.bytes.set(value, this.#at);
    this.#at += value.length;
    return this;
  }
}

// MS-DOS time and date (§ 4.4.6), in UTC: two-second steps, years from 1980
interface DosStamp {
  readonly time: number;
  readonly date: number;
}

const dosStamp = (date: Date): DosStamp => {
  const year = Math.max(1980, date.getUTCFullYear());
  return {
    date: (year - 1980) * 512 + (date.getUTCMonth() + 1) * 32 + date.getUTCDate(),
    time:
      date.getUTCHours() * 2048 + date.getUTCMinutes() * 32 + Math.floor(date.getUTCSeconds() / 2),
  };
};

// what the central directory says of one file the zip holds, as plain values a writer can keep
// between its runs
export interface ZipRecord {
  readonly path: string;
  readonly method: number;
  readonly time: number;
  readonly date: number;
  readonly crc: number;
  readonly compressed: number;
  readonly size: number;
  readonly offset: number;
}

// a file's bytes as they pass, counted and folded into its CRC
const measuring = (into: { crc: number; size: number }) =>
  new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      into.crc = crc32(into.crc, chunk);
      into.size += chunk.length;
      controller.enqueue(chunk);
    },
  });

const localHeader = (file: { name: Uint8Array; method: number; stamp: DosStamp }) =>
  new Record(30 + file.name.length)
    .u32(LOCAL_HEADER)
    .u16(VERSION)
    .u16(FLAGS)
    .u16(file.method)
    .u16(file.stamp.time)
    .u16(file.stamp.date)
    // CRC and both sizes: the data descriptor's
    .u32(0)
    .u32(0)
    .u32(0)
    .u16(file.name.length)
    .u16(0)
    .raw(file.name).bytes;

// one file's entry in the central directory
export const centralHeader = (file: ZipRecord): Uint8Array => {
  const name = encoder.encode(file.path);
  const farOffset = file.offset >= U32_MAX;
  const extra = farOffset ? new Record(12).u16(ZIP64_EXTRA).u16(8).u64(file.offset).bytes : null;
  return (
    new Record(46 + name.length + (extra?.length ?? 0))
      .u32(CENTRAL_HEADER)
      .u16(MADE_BY)
      .u16(farOffset ? VERSION_ZIP64 : VERSION)
      .u16(FLAGS)
      .u16(file.method)
      .u16(file.time)
      .u16(file.date)
      .u32(file.crc)
      .u32(file.compressed)
      .u32(file.size)
      .u16(name.length)
      .u16(extra?.length ?? 0)
      // comment, disk, internal and external attributes
      .u16(0)
      .u16(0)
      .u16(0)
      .u32(0)
      .u32(farOffset ? U32_MAX : file.offset)
      .raw(name)
      .raw(extra ?? new Uint8Array()).bytes
  );
};

// the records that close the zip: `count` files, a directory of `size` bytes at `offset`
export const endRecords = (count: number, size: number, offset: number): Uint8Array => {
  const zip64 = count >= U16_MAX || size >= U32_MAX || offset >= U32_MAX;
  const end = new Record(22)
    .u32(END_OF_DIRECTORY)
    .u16(0)
    .u16(0)
    .u16(zip64 ? U16_MAX : count)
    .u16(zip64 ? U16_MAX : count)
    .u32(zip64 ? U32_MAX : size)
    .u32(zip64 ? U32_MAX : offset)
    .u16(0).bytes;
  if (!zip64) {
    return end;
  }
  const record = new Record(56)
    .u32(ZIP64_END_OF_DIRECTORY)
    // the record's size past this field
    .u64(44)
    .u16(MADE_BY)
    .u16(VERSION_ZIP64)
    .u32(0)
    .u32(0)
    .u64(count)
    .u64(count)
    .u64(size)
    .u64(offset).bytes;
  const locator = new Record(20)
    .u32(ZIP64_LOCATOR)
    .u32(0)
    .u64(offset + size)
    .u32(1).bytes;
  return new Record(record.length + locator.length + end.length).raw(record).raw(locator).raw(end)
    .bytes;
};

const chunksOf = async function* chunksOf(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      yield read.value;
    }
  } finally {
    reader.releaseLock();
  }
};

// one file written into the zip at `offset`, each of its bytes handed to `write` in order as they
// are read (its local header, its data, its data descriptor); it answers the file's directory record
export const writeZipEntry = async (
  file: ZipFile,
  offset: number,
  write: (chunk: Uint8Array) => Promise<void>,
): Promise<ZipRecord> => {
  const name = encoder.encode(file.path);
  const method = file.deflate ? DEFLATED : STORED;
  const stamp = dosStamp(file.modified);
  await write(localHeader({ method, name, stamp }));
  const measured = { crc: 0, size: 0 };
  const opened = await file.open();
  const plain = opened.pipeThrough(measuring(measured));
  const body = file.deflate ? plain.pipeThrough(new CompressionStream("deflate-raw")) : plain;
  let compressed = 0;
  for await (const chunk of chunksOf(body)) {
    compressed += chunk.length;
    await write(chunk);
  }
  if (measured.size >= U32_MAX || compressed >= U32_MAX) {
    throw new RangeError(`${file.path} is 4 GiB or more, which this writer does not take`);
  }
  await write(
    new Record(16).u32(DATA_DESCRIPTOR).u32(measured.crc).u32(compressed).u32(measured.size).bytes,
  );
  return {
    compressed,
    crc: measured.crc,
    date: stamp.date,
    method,
    offset,
    path: file.path,
    size: measured.size,
    time: stamp.time,
  };
};
