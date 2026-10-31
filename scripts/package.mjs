/**
 * npm run package: builds ap-turm-v<version>.zip from the system folder (system.json at the top level of the zip),
 * without node_modules, test, docs, .git, .claude (local editor settings), *.zip and *.pdf (the GM guide ships next to the zip).
 * No dependencies: minimal zip writer (deflate + CRC32).
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..");
const EXCLUDE_DIRS = new Set(["node_modules", "test", "docs", "tools", ".git", ".claude"]);
const EXCLUDE_FILE = (name) => name.endsWith(".zip") || name.endsWith(".pdf") || name === ".DS_Store" || name === "Thumbs.db";

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "system.json"), "utf8"));
const out = path.join(ROOT, `${manifest.id}-v${manifest.version}.zip`);

/** Collect files relative to ROOT, sorted, excluding the unwanted directories and files. */
function collect(dir = "") {
  const files = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) { if (!EXCLUDE_DIRS.has(entry.name)) files.push(...collect(rel)); }
    else if (!EXCLUDE_FILE(entry.name)) files.push(rel);
  }
  return files;
}

const CRC_TABLE = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xFFFFFFFF; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function dosTime(d) {
  return { time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF, date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF };
}

/** Write a zip (deflate, UTF-8 names) with the given relative file names. */
export function writeZip(files, target) {
  const locals = [], centrals = [];
  let offset = 0;
  const now = dosTime(new Date());
  for (const rel of files) {
    const data = fs.readFileSync(path.join(ROOT, rel));
    const name = Buffer.from(rel, "utf8");
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const stored = deflated.length < data.length ? deflated : data;
    const method = stored === deflated ? 8 : 0;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(method, 8);
    local.writeUInt16LE(now.time, 10); local.writeUInt16LE(now.date, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(method, 10);
    central.writeUInt16LE(now.time, 12); central.writeUInt16LE(now.date, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(stored.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36); central.writeUInt32LE(0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, name, stored);
    centrals.push(central, name);
    offset += local.length + name.length + stored.length;
  }
  const cdSize = centrals.reduce((a, b) => a + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  fs.writeFileSync(target, Buffer.concat([...locals, ...centrals, end]));
}

const files = collect();
if (!files.includes("system.json")) throw new Error("system.json missing");
writeZip(files, out);
const size = fs.statSync(out).size;
console.log(`${path.basename(out)}: ${files.length} files, ${(size / 1024).toFixed(0)} KB`);
console.log(files.filter(f => !f.includes("/")).join(", ") + ` + ${files.filter(f => f.includes("/")).length} files in ${[...new Set(files.filter(f => f.includes("/")).map(f => f.split("/")[0]))].join(", ")}`);
