const COLLECTION_TAG = 0x74_74_63_66;
const HEADER_BYTES = 12;
const RECORD_BYTES = 16;

const aligned = (length: number) => Math.ceil(length / 4) * 4;

export const isCollection = (bytes: Uint8Array) =>
  bytes.length >= HEADER_BYTES &&
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0) === COLLECTION_TAG;

export const collectionSize = (bytes: Uint8Array) =>
  isCollection(bytes)
    ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8)
    : 1;

export const fontInCollection = (bytes: Uint8Array, index: number) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = view.getUint32(HEADER_BYTES + index * 4);
  const tables = view.getUint16(start + 4);

  const records = Array.from({ length: tables }, (_, at) => {
    const record = start + HEADER_BYTES + at * RECORD_BYTES;

    return {
      checksum: view.getUint32(record + 4),
      length: view.getUint32(record + 12),
      offset: view.getUint32(record + 8),
      tag: view.getUint32(record),
    };
  });

  const directory = HEADER_BYTES + tables * RECORD_BYTES;
  const size = records.reduce((total, { length }) => total + aligned(length), directory);
  const out = new Uint8Array(size);
  const written = new DataView(out.buffer);
  out.set(bytes.subarray(start, start + HEADER_BYTES), 0);
  let offset = directory;

  for (const [at, record] of records.entries()) {
    const entry = HEADER_BYTES + at * RECORD_BYTES;
    written.setUint32(entry, record.tag);
    written.setUint32(entry + 4, record.checksum);
    written.setUint32(entry + 8, offset);
    written.setUint32(entry + 12, record.length);
    out.set(bytes.subarray(record.offset, record.offset + record.length), offset);
    offset += aligned(record.length);
  }

  return out;
};
