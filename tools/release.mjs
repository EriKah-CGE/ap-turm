/**
 * npm run release -- <x.y.z>
 *
 * Publishes a new version of the system on GitHub so Foundry offers it as an update:
 *   1. checks: clean working tree, version > current, tag v<x.y.z> unknown locally and on origin,
 *      CHANGELOG.md has a "## <x.y.z>" section
 *   2. sets the version in system.json and package.json, rewrites the download URL to this version
 *   3. builds ap-turm.zip (files at the top level of the zip, only what Foundry needs)
 *   4. commits "Release v<x.y.z>", tags v<x.y.z>, pushes branch and tag
 *   5. gh release create v<x.y.z> ap-turm.zip system.json, notes from the CHANGELOG section
 * No dependencies: minimal zip writer (deflate + CRC32) as in scripts/package.mjs.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..");
const ZIP_NAME = "ap-turm.zip";
/** Top-level entries that go into the zip; everything else (test, tools, docs, scripts, CLAUDE.md, the app, zips) stays out. */
const INCLUDE = ["system.json", "module", "templates", "styles", "lang", "icons", "tiles", "README.md", "LICENSE"];
/** Never in the Foundry zip: the character sheet web app served by GitHub Pages (app, entry page, PWA files, app icons). */
const EXCLUDE = new Set(["ap-character-sheet.html", "index.html", "manifest.webmanifest", "sw.js", ".nojekyll", "icons/app-192.png", "icons/app-512.png"]);

const fail = (msg) => { console.error(`release: ${msg}`); process.exit(1); };
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
const runLoud = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit" });

/* ---------- arguments and checks ---------- */

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) fail("usage: npm run release -- <x.y.z>");
const tag = `v${version}`;

const parse = (v) => v.split(".").map(Number);
function isGreater(a, b) {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

if (run("git", ["status", "--porcelain"])) fail("working tree is not clean - commit or stash first (git status)");

const manifestPath = path.join(ROOT, "system.json");
const packagePath = path.join(ROOT, "package.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
if (!isGreater(version, manifest.version)) fail(`version ${version} is not greater than the current ${manifest.version}`);

if (run("git", ["tag", "--list", tag])) fail(`tag ${tag} already exists locally`);
if (run("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`])) fail(`tag ${tag} already exists on origin`);

/** Section "## <version>" (optionally "## [<version>]" and a date suffix) up to the next "## ". */
function changelogNotes() {
  const file = path.join(ROOT, "CHANGELOG.md");
  if (!fs.existsSync(file)) fail("CHANGELOG.md missing");
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const esc = version.replace(/\./g, "\\.");
  const start = lines.findIndex(l => new RegExp(`^##\\s+\\[?${esc}\\]?(\\s|$)`).test(l));
  if (start < 0) fail(`CHANGELOG.md has no section "## ${version}" - add it and commit first`);
  let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  if (end < 0) end = lines.length;
  const notes = lines.slice(start + 1, end).join("\n").trim();
  if (!notes) fail(`CHANGELOG.md section ${version} is empty`);
  return notes;
}
const notes = changelogNotes();

if (!manifest.url) fail("system.json has no url");
const repoUrl = manifest.url.replace(/\/$/, "");

/* ---------- (a) version and download URL ---------- */

manifest.version = version;
manifest.manifest = `${repoUrl}/releases/latest/download/system.json`;
manifest.download = `${repoUrl}/releases/download/${tag}/${ZIP_NAME}`;
pkg.version = version;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + "\n");
console.log(`system.json/package.json -> ${version}, download ${manifest.download}`);

/* ---------- (b) zip ---------- */

function collect(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return [];
  if (!fs.statSync(abs).isDirectory()) return [rel];
  return fs.readdirSync(abs, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter(e => e.name !== ".DS_Store" && e.name !== "Thumbs.db")
    .flatMap(e => collect(`${rel}/${e.name}`));
}

const CRC_TABLE = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xFFFFFFFF; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function dosTime(d) {
  return { time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF, date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF };
}

function writeZip(files, target) {
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

const files = INCLUDE.flatMap(collect).filter(f => !EXCLUDE.has(f));
const required = ["system.json", ...(manifest.esmodules ?? []), ...(manifest.styles ?? []), ...(manifest.languages ?? []).map(l => l.path)];
const missing = required.filter(f => !files.includes(f));
if (missing.length) {
  run("git", ["checkout", "--", "system.json", "package.json"]);
  fail(`files named in system.json are missing: ${missing.join(", ")} (version change reverted)`);
}
const zipPath = path.join(ROOT, ZIP_NAME);
writeZip(files, zipPath);
console.log(`${ZIP_NAME}: ${files.length} files, ${(fs.statSync(zipPath).size / 1024).toFixed(0)} KB`);

/* ---------- (c) commit, tag, push ---------- */

runLoud("git", ["add", "system.json", "package.json"]);
runLoud("git", ["commit", "-m", `Release ${tag}`]);
runLoud("git", ["tag", "-a", tag, "-m", `Release ${tag}`]);
const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
runLoud("git", ["push", "origin", branch]);
runLoud("git", ["push", "origin", tag]);

/* ---------- (d) GitHub release ---------- */

const notesFile = path.join(os.tmpdir(), `ap-turm-release-${version}.md`);
fs.writeFileSync(notesFile, notes + "\n");
try {
  runLoud("gh", ["release", "create", tag, ZIP_NAME, "system.json", "--title", `ap-turm ${tag}`, "--notes-file", notesFile, "--latest"]);
} finally {
  fs.rmSync(notesFile, { force: true });
}

console.log(`\nReleased ${tag}.`);
console.log(`Manifest: ${manifest.manifest}`);
console.log(`Download: ${manifest.download}`);
