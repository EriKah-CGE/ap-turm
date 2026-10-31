/**
 * Extract dnd5e spells and creatures from local compendium packs into import bundles for the AP-Turm libraries.
 *
 *   node tools/dnd5e-extract.mjs
 *
 * - Reads COPIES of the LevelDB packs (with Foundry's bundled classic-level, like the foundryvtt-cli), never the
 *   originals; NeDB .db packs are read as text.
 * - Converts with module/dnd5e-convert.mjs (content 1:1, only the document shell changes).
 * - One bundle per source and kind (spells-<source>.json / monsters-<source>.json), one compendium each in the
 *   world. Equal names from different sources all stay; duplicates are only dropped WITHIN one source.
 * - Images: core icons, files under Data and web addresses (e.g. D&D Beyond avatars) are kept; world-local files
 *   (worlds/...) are copied to Data/ap-turm-import/images/; missing files fall back to the default icon (report).
 * - The GM imports the bundles in the world (Actors sidebar -> AP-Turm -> Import dnd5e libraries).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { convertSpell, convertMonster, dedupeWithinSource, crBand, bundleFile, sourceDef } from "../module/dnd5e-convert.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(HERE, "../../..");                         // .../Data
const FOUNDRY = process.env.FOUNDRY_APP ?? "C:/Program Files/Foundry Virtual Tabletop/resources/app";
const require = createRequire(path.join(FOUNDRY, "package.json"));
const { ClassicLevel } = require("classic-level");
const OUT = path.join(DATA, "ap-turm-import");

/** The sources chosen by the GM (keys: see LIBRARY_SOURCES in module/dnd5e-convert.mjs). */
const SOURCES = {
  spells: [
    { key: "srd2014", pack: "systems/dnd5e/packs/spells" },
    { key: "srd2024", pack: "systems/dnd5e/packs/spells24" },
    { key: "ddb-terra-nova", pack: "worlds/terra-nova/packs/ddb-terra-nova-ddb-spells" }
  ],
  monsters: [
    { key: "srd2014", pack: "systems/dnd5e/packs/monsters" },
    { key: "srd2024", pack: "systems/dnd5e/packs/actors24" },
    { key: "ddb-terra-nova", pack: "worlds/terra-nova/packs/ddb-terra-nova-ddb-monsters" }
  ]
};

/* ---------- reading packs ---------- */

async function readPack(rel) {
  const p = path.join(DATA, rel);
  if (fs.existsSync(p + ".db")) return fs.readFileSync(p + ".db", "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)).map(d => ({ key: "", doc: d }));
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), "apt-pack-"));
  fs.cpSync(p, copy, { recursive: true });
  fs.rmSync(path.join(copy, "LOCK"), { force: true });
  const db = new ClassicLevel(copy, { valueEncoding: "json" });
  const out = [];
  try { for await (const [key, doc] of db.iterator()) out.push({ key, doc }); } finally { await db.close(); fs.rmSync(copy, { recursive: true, force: true }); }
  return out;
}

/** Top-level documents of a pack with embedded items resolved (LevelDB stores them under their own keys). */
function assemble(entries, collection) {
  const byKey = new Map(entries.map(e => [e.key, e.doc]));
  const docs = [];
  for (const { key, doc } of entries) {
    if (key && !key.startsWith(`!${collection}!`)) continue;
    const d = structuredClone(doc);
    if (collection === "actors" && Array.isArray(d.items)) {
      d.items = d.items.map(it => (typeof it === "string" ? byKey.get(`!actors.items!${d._id}.${it}`) : it)).filter(Boolean);
    }
    docs.push(d);
  }
  return docs;
}

/* ---------- images ---------- */

/** Image report per source key: {kept, web, copied:[], fallback:[]} */
const imageReports = {};
function resolveImage(src, owner, source) {
  const imageReport = (imageReports[source] ??= { kept: 0, web: 0, copied: [], fallback: [] });
  if (!src) return "";
  let p = String(src).trim();
  // web images (D&D Beyond avatars) stay: the table plays online; a dead link shows Foundry's default later
  if (/^https?:\/\//i.test(p)) { imageReport.web++; return p; }
  p = p.replace(/^\/+/, "");
  const decoded = decodeURIComponent(p);
  if (/^icons\//.test(decoded) && fs.existsSync(path.join(FOUNDRY, "public", decoded))) { imageReport.kept++; return p; }
  const onDisk = path.join(DATA, decoded);
  if (/^worlds\//.test(decoded)) {
    if (!fs.existsSync(onDisk)) { imageReport.fallback.push({ owner, src: p, why: "file missing" }); return ""; }
    const rel = path.posix.join("ap-turm-import/images", decoded.replace(/^worlds\//, ""));
    const target = path.join(DATA, rel);
    if (!fs.existsSync(target)) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(onDisk, target); imageReport.copied.push({ owner, from: p, to: rel }); }
    return rel.split("/").map(encodeURIComponent).join("/");
  }
  if (fs.existsSync(onDisk)) { imageReport.kept++; return p; }
  imageReport.fallback.push({ owner, src: p, why: "file missing" });
  return "";
}

/* ---------- main ---------- */

/** Build the bundles of one kind: one per source, duplicates only dropped within a source. */
async function build(kind) {
  const all = [], errors = [], counts = {};
  for (const src of SOURCES[kind]) {
    const label = sourceDef(src.key)?.label ?? src.key;
    const entries = await readPack(src.pack);
    const docs = assemble(entries, kind === "spells" ? "items" : "actors").filter(d => d.type === (kind === "spells" ? "spell" : "npc"));
    counts[src.key] = docs.length;
    for (const d of docs) {
      try {
        const img = resolveImage(d.img, d.name, src.key);
        if (kind === "spells") all.push({ name: d.name, source: src.key, data: convertSpell(d, { source: label, img }) });
        else {
          const tokenImg = resolveImage(d.prototypeToken?.texture?.src, d.name, src.key);
          all.push({ name: d.name, source: src.key, data: convertMonster(d, { source: label, mode: "turm", img, tokenImg }), folder: crBand(d.system?.details?.cr) });
        }
      } catch (e) { errors.push({ name: d?.name ?? "?", source: src.key, error: String(e?.message ?? e) }); }
    }
  }
  const { bySource, dropped } = dedupeWithinSource(all);
  return SOURCES[kind].map(src => ({
    format: "ap-turm-dnd5e-import", kind, source: src.key, label: sourceDef(src.key)?.label ?? src.key,
    created: new Date().toISOString(), sources: [{ source: sourceDef(src.key)?.label ?? src.key, count: counts[src.key] ?? 0 }],
    docs: (bySource.get(src.key) ?? []).map(k => ({ folder: k.folder ?? null, data: k.data })),
    report: { duplicates: dropped.filter(x => x.source === src.key), conversionErrors: errors.filter(x => x.source === src.key) }
  }));
}

fs.mkdirSync(OUT, { recursive: true });
// bundles of the earlier single-library layout are replaced
for (const old of ["spells.json", "monsters.json"]) fs.rmSync(path.join(OUT, old), { force: true });
for (const kind of ["spells", "monsters"]) {
  const t0 = Date.now();
  const bundles = await build(kind);
  for (const b of bundles) {
    const ir = imageReports[b.source] ?? { kept: 0, web: 0, copied: [], fallback: [] };
    b.report.images = { kept: ir.kept, web: ir.web, copied: ir.copied.length, fallback: ir.fallback };
    fs.writeFileSync(path.join(OUT, bundleFile(kind, b.source)), JSON.stringify(b));
    console.log(`${bundleFile(kind, b.source)}: ${b.docs.length} documents (${b.sources[0].count} in the pack), ${b.report.duplicates.length} duplicates within the source, ${b.report.conversionErrors.length} conversion errors; images ${ir.kept} kept, ${ir.web} web, ${ir.copied.length} copied, ${ir.fallback.length} default`);
  }
  for (const k of Object.keys(imageReports)) delete imageReports[k];
}
