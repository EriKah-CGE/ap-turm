/**
 * Backup of all characters: every Actor of type "character" as its own app JSON (the same export as the sheet's
 * "Export JSON"), bundled in one zip file. Foundry v13 ships no zip library in the client, so the zip is written
 * here: "stored" entries (no compression) with CRC-32, which every unzip tool reads. There is no import
 * counterpart - each JSON goes back in through the normal single import.
 * The same zip writer serves the library bundles (libraries5e.mjs): zipDeflated compresses entries with the
 * built-in CompressionStream, unzipEntries reads stored and deflated entries (also zips from other tools).
 * The pure parts (file names, zip writer) are tested in Node; Foundry globals are only used inside functions.
 */
import { exportAppData } from "./exporter.mjs";

const SYSTEM_ID = "ap-turm";

/** "2026-09-23" for a date (local time). */
export function dateStamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** ap_<name>_<date>.json (name as in the app's file names: lower case, word characters). */
export function backupFileName(name, date = new Date()) {
  const safe = String(name || "character").replace(/[^\w\-]+/g, "_").toLowerCase();
  return `ap_${safe}_${dateStamp(date)}.json`;
}

/** File names for a list of names; equal names get _2, _3 ... before the extension. */
export function uniqueFileNames(names, date = new Date()) {
  const seen = new Map();
  return names.map(n => {
    const base = backupFileName(n, date);
    const k = (seen.get(base) ?? 0) + 1;
    seen.set(base, k);
    return k === 1 ? base : base.replace(/\.json$/, `_${k}.json`);
  });
}

/** Zip file name of the backup. */
export const backupZipName = (date = new Date()) => `ap-turm-characters_${dateStamp(date)}.zip`;

/**
 * The backup files for characters given as plain data.
 * @param {{name:string, system:object, items:object[]}[]} characters
 * @returns {{name:string, data:object}[]}
 */
export function backupFiles(characters, date = new Date()) {
  const names = uniqueFileNames(characters.map(c => c.name), date);
  return characters.map((c, i) => ({ name: names[i], data: exportAppData(c) }));
}

/* ---------- zip writer (stored entries) ---------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();

/** CRC-32 of a byte array. */
export function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** DOS time / date fields of a zip entry. */
function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/**
 * Build a zip archive.
 * @param {{name:string, text?:string, bytes?:Uint8Array, deflated?:Uint8Array}[]} files  UTF-8 text or bytes;
 *   `deflated` (raw deflate of the bytes, see zipDeflated) stores the entry compressed (method 8)
 * @param {Date} [date]
 * @returns {Uint8Array}
 */
export function makeZip(files, date = new Date()) {
  const enc = new TextEncoder();
  const { time, date: dosDate } = dosDateTime(date);
  const locals = [], centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = f.bytes ?? enc.encode(f.text ?? "");
    const stored = f.deflated ?? data;
    const method = f.deflated ? 8 : 0;
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true);   // UTF-8 names
    lv.setUint16(8, method, true); lv.setUint16(10, time, true); lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, stored.length, true); lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true); cv.setUint16(12, time, true); cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, stored.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local, stored);
    centrals.push(central);
    offset += local.length + stored.length;
  }
  const cdSize = centrals.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let pos = 0;
  for (const part of [...locals, ...centrals, end]) { out.set(part, pos); pos += part.length; }
  return out;
}

/**
 * Read the entries of a zip: stored (method 0) entries come with text and a CRC check; for compressed ones
 * `bytes` is the raw deflate data (unzipEntries inflates them).
 * @param {Uint8Array} bytes
 * @returns {{name:string, method:number, size:number, crc:number, bytes:Uint8Array, text?:string, crcOk?:boolean}[]}
 */
export function readZip(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  let e = bytes.length - 22;
  while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error("not a zip file");
  const count = v.getUint16(e + 10, true);
  let p = v.getUint32(e + 16, true);
  const out = [];
  for (let i = 0; i < count; i++) {
    const nameLen = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true), comment = v.getUint16(p + 32, true);
    const method = v.getUint16(p + 10, true), packed = v.getUint32(p + 20, true), size = v.getUint32(p + 24, true);
    const crc = v.getUint32(p + 16, true), local = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + packed);
    const entry = { name, method, size, crc, bytes: data };
    if (method === 0) { entry.text = dec.decode(data); entry.crcOk = crc32(data) === crc; }
    out.push(entry);
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

/* ---------- deflate (CompressionStream: browsers and Node 18+) ---------- */

async function streamBytes(bytes, stream) {
  const out = await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(out);
}
export const deflateRaw = (bytes) => streamBytes(bytes, new CompressionStream("deflate-raw"));
export const inflateRaw = (bytes) => streamBytes(bytes, new DecompressionStream("deflate-raw"));

/**
 * makeZip with compression: every entry is deflated when that makes it smaller (JSON shrinks a lot, images do not).
 * @param {{name:string, text?:string, bytes?:Uint8Array}[]} files
 * @returns {Promise<Uint8Array>}
 */
export async function zipDeflated(files, date = new Date()) {
  const enc = new TextEncoder();
  const prepared = [];
  for (const f of files) {
    const bytes = f.bytes ?? enc.encode(f.text ?? "");
    const deflated = f.compress === false ? null : await deflateRaw(bytes);
    prepared.push({ name: f.name, bytes, ...(deflated && deflated.length < bytes.length ? { deflated } : {}) });
  }
  return makeZip(prepared, date);
}

/**
 * All entries of a zip with their plain bytes (stored and deflated entries; directories are left out).
 * @returns {Promise<{name:string, bytes:Uint8Array, crcOk:boolean}[]>}
 */
export async function unzipEntries(bytes) {
  const out = [];
  for (const e of readZip(bytes)) {
    if (e.name.endsWith("/")) continue;
    if (e.method !== 0 && e.method !== 8) throw new Error(`${e.name}: unsupported zip compression (method ${e.method})`);
    const plain = e.method === 8 ? await inflateRaw(e.bytes) : e.bytes;
    out.push({ name: e.name, bytes: plain, crcOk: crc32(plain) === e.crc && plain.length === e.size });
  }
  return out;
}

/* ---------- Foundry ---------- */

/** Menu entry "Export all characters" (GM): one zip with an app JSON per character, whisper to the GM. */
export async function exportAllCharacters() {
  if (!game.user.isGM) return null;
  const actors = game.actors.filter(a => a.type === "character").sort((a, b) => a.name.localeCompare(b.name));
  if (!actors.length) { ui.notifications.warn("There are no characters to export."); return null; }
  const now = new Date();
  const files = backupFiles(actors.map(a => ({ name: a.name, system: a.system.toObject(), items: a.items.map(i => i.toObject()) })), now);
  const zip = makeZip(files.map(f => ({ name: f.name, text: JSON.stringify(f.data, null, 2) })), now);
  const zipName = backupZipName(now);
  foundry.utils.saveDataToFile(zip, "application/zip", zipName);
  await ChatMessage.implementation.create({
    content: `<p><b>Character backup:</b> ${files.length} character${files.length === 1 ? "" : "s"} exported to ${foundry.utils.escapeHTML(zipName)}.</p>`,
    whisper: [game.user.id],
    speaker: { alias: "AP-Turm" }
  });
  return { zipName, files: files.map(f => f.name) };
}

export const backup = { exportAllCharacters, backupFiles, backupFileName, makeZip, readZip, zipDeflated, unzipEntries };
