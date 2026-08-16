// ---------------------------------------------------------------------------
// A ZIP archive as a pull-driven byte stream.
//
// STREAMING IS THE REQUIREMENT, not an optimization. A Worker isolate has 128
// MiB and a vault is allowed to be larger than that, so nothing here ever holds
// a whole file — let alone the whole archive — in memory. Every byte is read
// from its source, compressed, and handed to the consumer before the next chunk
// is asked for. The stream is built with `pull` rather than pushed into a
// writable, so backpressure is the consumer's read: an archive nobody is
// downloading does no work.
//
// The consequence is that SIZES ARE NOT KNOWN WHEN A HEADER IS WRITTEN. That is
// what general-purpose bit 3 is for: the local header writes zeros, and the
// real crc-32 and sizes follow the data in a descriptor record. The central
// directory at the end repeats them, which is where a reader actually looks.
//
// 32-BIT ONLY, and the caller must enforce that (see MAX_TOTAL_BYTES /
// MAX_ENTRIES). Zip64 exists for archives past 4 GiB or 65,535 members; adding
// it means a second header format on every entry, and the failure it prevents
// is one the caller can rule out BEFORE the first byte goes out, from manifest
// numbers it already has. A refusal with nothing sent beats a truncated archive
// that unzips to garbage.
// ---------------------------------------------------------------------------

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;

/** Deflate, as ZIP numbers compression methods. */
const METHOD_DEFLATE = 8;

/** Bit 3 defers crc + sizes to a data descriptor; bit 11 declares UTF-8 names.
 * Both are needed here: names come from vault paths, which are not ASCII. */
const FLAG_DATA_DESCRIPTOR = 0x0008;
const FLAG_UTF8_NAMES = 0x0800;

/** PKZIP 2.0 — deflate and data descriptors, nothing newer. */
const VERSION_NEEDED = 20;

/**
 * The ceilings the classic format imposes, which a caller must check against
 * the manifest before starting. Total is the UNCOMPRESSED sum with headroom:
 * deflate's worst case expands by well under a percent, and the central
 * directory adds ~46 bytes plus a name per entry.
 */
export const MAX_TOTAL_BYTES = 3.5 * 1024 * 1024 * 1024;
export const MAX_ENTRIES = 0xffff;

/** One member of the archive: the name it takes inside, and its bytes. */
export type ZipSource = {
  readonly name: string;
  /** Opened lazily — one R2 GET at a time, when the consumer reaches it.
   * `null` means the bytes are gone, and the member is simply left out. */
  readonly open: () => Promise<ReadableStream<Uint8Array> | null>;
};

/** What the archive records as each member's timestamp. */
export type ZipClock = () => Date;

/**
 * The archive over `sources`, as bytes.
 *
 * Members are visited in order and one at a time, because the point is a
 * bounded memory footprint rather than a fast one — a parallel fan-out would
 * hold N file bodies at once and put the isolate back where it started.
 */
export function zipStream(
  sources: readonly ZipSource[],
  clock: ZipClock,
): ReadableStream<Uint8Array> {
  const chunks = archiveChunks(sources, clock);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await chunks.next();
      if (next.done === true) {
        controller.close();
        return;
      }
      controller.enqueue(next.value);
    },
    async cancel() {
      // A consumer that navigated away must not leave the generator holding an
      // open R2 body.
      await chunks.return(undefined);
    },
  });
}

/** One member's facts, as the central directory needs them afterwards. */
type CentralEntry = {
  readonly name: Uint8Array;
  readonly crc: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly dosTime: number;
  readonly dosDate: number;
  readonly localOffset: number;
};

async function* archiveChunks(
  sources: readonly ZipSource[],
  clock: ZipClock,
): AsyncGenerator<Uint8Array, void, undefined> {
  const encoder = new TextEncoder();
  const entries: CentralEntry[] = [];
  let offset = 0;

  for (const source of sources) {
    const body = await source.open();
    // A manifest row whose blob is missing is a storage fault the export
    // cannot fix; leaving the member out beats aborting an archive the user is
    // already downloading.
    if (body === null) continue;

    const name = encoder.encode(source.name);
    const stamp = dosStamp(clock());
    const localOffset = offset;
    const header = localHeader(name, stamp);
    yield header;
    offset += header.length;

    const crc = new Crc32();
    let uncompressedSize = 0;
    // The tap counts and digests the SOURCE bytes on their way into the
    // compressor, so one pass over the body produces both — no tee, no second
    // read, no buffer.
    const tap = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        crc.update(chunk);
        uncompressedSize += chunk.length;
        controller.enqueue(chunk);
      },
    });
    const deflated = body.pipeThrough(tap).pipeThrough(new CompressionStream("deflate-raw"));
    const reader = deflated.getReader();
    let compressedSize = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        compressedSize += chunk.value.length;
        offset += chunk.value.length;
        yield chunk.value;
      }
    } finally {
      reader.releaseLock();
    }

    const digest = crc.value();
    const descriptor = dataDescriptor(digest, compressedSize, uncompressedSize);
    yield descriptor;
    offset += descriptor.length;

    entries.push({
      name,
      crc: digest,
      compressedSize,
      uncompressedSize,
      dosTime: stamp.time,
      dosDate: stamp.date,
      localOffset,
    });
  }

  const directoryOffset = offset;
  let directorySize = 0;
  for (const entry of entries) {
    const record = centralHeader(entry);
    directorySize += record.length;
    yield record;
  }
  yield endOfCentralDirectory(entries.length, directorySize, directoryOffset);
}

type DosStamp = { readonly time: number; readonly date: number };

/** MS-DOS date/time, which is what ZIP records: two-second resolution, epoch
 * 1980. Dates before that are not representable, so they clamp to it. */
function dosStamp(at: Date): DosStamp {
  const year = Math.max(1980, at.getUTCFullYear());
  return {
    time: (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | (at.getUTCSeconds() >> 1),
    date: ((year - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
  };
}

function localHeader(name: Uint8Array, stamp: DosStamp): Uint8Array {
  const buffer = new Uint8Array(30 + name.length);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, LOCAL_HEADER_SIGNATURE, true);
  view.setUint16(4, VERSION_NEEDED, true);
  view.setUint16(6, FLAG_DATA_DESCRIPTOR | FLAG_UTF8_NAMES, true);
  view.setUint16(8, METHOD_DEFLATE, true);
  view.setUint16(10, stamp.time, true);
  view.setUint16(12, stamp.date, true);
  // crc + both sizes stay zero here; the descriptor after the data carries them.
  view.setUint16(26, name.length, true);
  buffer.set(name, 30);
  return buffer;
}

function dataDescriptor(crc: number, compressedSize: number, uncompressedSize: number): Uint8Array {
  const buffer = new Uint8Array(16);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, DATA_DESCRIPTOR_SIGNATURE, true);
  view.setUint32(4, crc, true);
  view.setUint32(8, compressedSize, true);
  view.setUint32(12, uncompressedSize, true);
  return buffer;
}

function centralHeader(entry: CentralEntry): Uint8Array {
  const buffer = new Uint8Array(46 + entry.name.length);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, CENTRAL_HEADER_SIGNATURE, true);
  view.setUint16(4, VERSION_NEEDED, true);
  view.setUint16(6, VERSION_NEEDED, true);
  view.setUint16(8, FLAG_DATA_DESCRIPTOR | FLAG_UTF8_NAMES, true);
  view.setUint16(10, METHOD_DEFLATE, true);
  view.setUint16(12, entry.dosTime, true);
  view.setUint16(14, entry.dosDate, true);
  view.setUint32(16, entry.crc, true);
  view.setUint32(20, entry.compressedSize, true);
  view.setUint32(24, entry.uncompressedSize, true);
  view.setUint16(28, entry.name.length, true);
  view.setUint32(42, entry.localOffset, true);
  buffer.set(entry.name, 46);
  return buffer;
}

function endOfCentralDirectory(count: number, size: number, offset: number): Uint8Array {
  const buffer = new Uint8Array(22);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, EOCD_SIGNATURE, true);
  view.setUint16(8, count, true);
  view.setUint16(10, count, true);
  view.setUint32(12, size, true);
  view.setUint32(16, offset, true);
  return buffer;
}

/** The reversed-polynomial CRC-32 ZIP records, table-driven and incremental so
 * a file's digest never needs its bytes gathered. */
class Crc32 {
  private static table: Uint32Array | null = null;
  private crc = 0xffffffff;

  update(chunk: Uint8Array): void {
    const table = Crc32.lookup();
    let crc = this.crc;
    for (const byte of chunk) {
      // `?? 0` never fires: the index is masked to 0..255 and the table is
      // 256 entries. Stated rather than asserted, so the code carries no `!`.
      crc = (crc >>> 8) ^ (table[(crc ^ byte) & 0xff] ?? 0);
    }
    this.crc = crc;
  }

  value(): number {
    return (this.crc ^ 0xffffffff) >>> 0;
  }

  private static lookup(): Uint32Array {
    if (Crc32.table !== null) return Crc32.table;
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index++) {
      let value = index;
      for (let bit = 0; bit < 8; bit++) {
        value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      table[index] = value >>> 0;
    }
    Crc32.table = table;
    return table;
  }
}
