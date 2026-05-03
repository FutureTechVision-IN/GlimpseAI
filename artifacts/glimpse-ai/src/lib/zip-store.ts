/**
 * Minimal ZIP archive writer (STORE method, no compression).
 *
 * - Zero dependencies. Pure JS + standard browser APIs (Blob, DataView, TextEncoder).
 * - Produces archives readable by every major OS file manager (Finder, Windows
 *   Explorer, `unzip`, 7-Zip) and the standard library zip readers.
 * - Uses STORE (method=0) instead of DEFLATE because the only payload we hand
 *   to it is already-compressed media (JPEG / PNG / WebP / MP4). Deflate over
 *   already-compressed data buys ~0% size and costs CPU + bundle weight, so we
 *   pay neither.
 * - CRC32 is computed with a 256-entry IEEE 802.3 polynomial table (RFC 1952).
 *
 * Format reference: APPNOTE.TXT (PKWARE) sections 4.3 (local file header),
 * 4.4 (data descriptor — not used here, sizes known up front), 4.5 (central
 * directory header), 4.6 (end of central directory record).
 */

// ─── CRC32 (IEEE 802.3 polynomial) ──────────────────────────────────────────
// Lookup table built once per module load.
const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export type ZipEntry = { name: string; data: Uint8Array };

/**
 * Build a ZIP archive containing the given entries (STORE method).
 *
 * Filenames are encoded as UTF-8. The general purpose bit 11 (UTF-8 flag) is
 * set so modern unzippers honour Unicode filenames.
 *
 * Returns a `Blob` of MIME type `application/zip`.
 */
export function buildStoreZip(entries: ZipEntry[]): Blob {
  const enc = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let runningOffset = 0;

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    const sum = crc32(entry.data);
    const size = entry.data.length >>> 0;

    // ── Local file header: 30 fixed bytes + filename ──
    const lfh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lfh.buffer);
    lv.setUint32(0, 0x04034b50, true);          // local file header signature
    lv.setUint16(4, 20, true);                   // version needed to extract = 2.0
    lv.setUint16(6, 0x0800, true);               // general purpose bit flag (UTF-8 filename)
    lv.setUint16(8, 0, true);                    // compression method = 0 (STORE)
    lv.setUint16(10, 0, true);                   // last mod time
    lv.setUint16(12, 0x21, true);                // last mod date (1980-01-01)
    lv.setUint32(14, sum, true);                 // crc-32 of uncompressed data
    lv.setUint32(18, size, true);                // compressed size (== size for STORE)
    lv.setUint32(22, size, true);                // uncompressed size
    lv.setUint16(26, nameBytes.length, true);    // filename length
    lv.setUint16(28, 0, true);                   // extra field length
    lfh.set(nameBytes, 30);
    localChunks.push(lfh);
    localChunks.push(entry.data);

    // ── Central directory header: 46 fixed bytes + filename ──
    const cdh = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cdh.buffer);
    cv.setUint32(0, 0x02014b50, true);           // central file header signature
    cv.setUint16(4, 0x031e, true);               // version made by (Unix, 3.0)
    cv.setUint16(6, 20, true);                   // version needed to extract
    cv.setUint16(8, 0x0800, true);               // general purpose bit flag (UTF-8)
    cv.setUint16(10, 0, true);                   // compression method
    cv.setUint16(12, 0, true);                   // last mod time
    cv.setUint16(14, 0x21, true);                // last mod date
    cv.setUint32(16, sum, true);                 // crc-32
    cv.setUint32(20, size, true);                // compressed size
    cv.setUint32(24, size, true);                // uncompressed size
    cv.setUint16(28, nameBytes.length, true);    // filename length
    cv.setUint16(30, 0, true);                   // extra field length
    cv.setUint16(32, 0, true);                   // comment length
    cv.setUint16(34, 0, true);                   // disk number start
    cv.setUint16(36, 0, true);                   // internal file attrs
    cv.setUint32(38, 0, true);                   // external file attrs
    cv.setUint32(42, runningOffset, true);       // relative offset of local header
    cdh.set(nameBytes, 46);
    centralChunks.push(cdh);

    runningOffset += lfh.length + entry.data.length;
  }

  const centralStart = runningOffset;
  const centralSize = centralChunks.reduce((acc, c) => acc + c.length, 0);

  // ── End of central directory record (22 bytes, no comment) ──
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);             // EOCD signature
  ev.setUint16(4, 0, true);                       // disk number
  ev.setUint16(6, 0, true);                       // disk number where CD starts
  ev.setUint16(8, entries.length, true);          // number of entries on this disk
  ev.setUint16(10, entries.length, true);         // total number of entries
  ev.setUint32(12, centralSize, true);            // size of central directory
  ev.setUint32(16, centralStart, true);           // offset of central directory
  ev.setUint16(20, 0, true);                      // .ZIP file comment length

  // Concatenate every chunk into a single ArrayBuffer-backed Uint8Array so
  // the Blob constructor receives a well-typed BlobPart (TS 5.7+ rejects
  // Uint8Array<ArrayBufferLike> directly).
  const totalSize = runningOffset + centralSize + eocd.length;
  const out = new Uint8Array(new ArrayBuffer(totalSize));
  let p = 0;
  for (const c of localChunks) { out.set(c, p); p += c.length; }
  for (const c of centralChunks) { out.set(c, p); p += c.length; }
  out.set(eocd, p);
  return new Blob([out], { type: "application/zip" });
}

/**
 * Decode a base64 string (with or without `data:` URI prefix) to Uint8Array.
 * Centralised here so callers building zip entries don't have to repeat the
 * `atob` + Uint8Array dance.
 */
export function base64ToBytes(input: string): Uint8Array {
  const b64 = input.includes(",") ? input.split(",", 2)[1] : input;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
