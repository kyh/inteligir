// The CRC-32 a zip stamps on every file (APPNOTE.TXT § 4.4.7: the IEEE polynomial, reflected),
// folded over a file's chunks as they stream by, since the platform offers no CRC of its own.

/* oxlint-disable no-bitwise -- a CRC is 32-bit integer arithmetic: the table, the shifts and the
   xors are the algorithm the zip format fixes, and nothing else spells it */
const TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xed_b8_83_20 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

// the running CRC with `bytes` folded in; start from 0
export const crc32 = (running: number, bytes: Uint8Array): number => {
  let crc = ~running >>> 0;
  for (const byte of bytes) {
    crc = (TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return ~crc >>> 0;
};
/* oxlint-enable no-bitwise */
