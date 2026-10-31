/**
 * npm run handover: fills Data/ap-turm-handover/ with everything a new GM needs:
 *   ap-turm-v<version>.zip   the system (built fresh by scripts/package.mjs)
 *   ap-turm-libraries.zip    the Spell/Monster libraries: the bundles in Data/ap-turm-import plus every local image
 *                            they use - the same content and layout as "Export bundles" in Foundry
 *   ap-turm-gm-guide.pdf     the GM guide
 *   HANDOVER.txt             five steps for the GM
 * Files of the same name in the folder are replaced; nothing else in it is touched.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { LIBRARY_SOURCES, LIBRARY_ZIP, bundleFile, bundleProblem, portableBundle, libraryZipFiles } from "../module/dnd5e-convert.mjs";
import { zipDeflated } from "../module/backup.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..");
const DATA = path.resolve(ROOT, "..", "..");
const IMPORT = path.join(DATA, "ap-turm-import");
const OUT = path.join(DATA, "ap-turm-handover");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "system.json"), "utf8"));
const systemZip = `${manifest.id}-v${manifest.version}.zip`;
const warnings = [];

fs.mkdirSync(OUT, { recursive: true });

// 1. the system zip, built fresh
const pkg = spawnSync(process.execPath, [path.join(ROOT, "scripts", "package.mjs")], { cwd: ROOT, encoding: "utf8" });
if (pkg.status !== 0) { console.error(pkg.stdout, pkg.stderr); process.exit(1); }
process.stdout.write(pkg.stdout);
fs.copyFileSync(path.join(ROOT, systemZip), path.join(OUT, systemZip));

// 2. the libraries zip
const bundles = [], imageSrc = new Map();
for (const kind of ["spells", "monsters"]) {
  for (const s of LIBRARY_SOURCES) {
    const file = bundleFile(kind, s.key);
    const full = path.join(IMPORT, file);
    if (!fs.existsSync(full)) { warnings.push(`${file} fehlt in Data/ap-turm-import`); continue; }
    let text = fs.readFileSync(full, "utf8");
    const bundle = JSON.parse(text);
    const problem = bundleProblem(bundle, kind, s.key);
    if (problem) { warnings.push(`${file}: ${problem}`); continue; }
    const portable = portableBundle(bundle);
    if (portable.changed) text = JSON.stringify(portable.bundle);
    for (const img of portable.images) imageSrc.set(img.path, img.src);
    bundles.push({ kind, key: s.key, text, count: bundle.docs.length });
  }
}
if (!bundles.length) {
  console.error("Keine Bundles in Data/ap-turm-import. In Foundry: Actors -> AP-Turm -> Import dnd5e libraries -> Export bundles schreibt sie aus den Kompendien zurück.");
  process.exit(1);
}
const images = [];
for (const [p, src] of [...imageSrc].sort((a, b) => a[0].localeCompare(b[0]))) {
  const file = path.join(DATA, ...src.split("/"));
  if (!fs.existsSync(file)) { warnings.push(`Bild fehlt: ${src}`); continue; }
  images.push({ path: p, bytes: new Uint8Array(fs.readFileSync(file)) });
}
const libZip = await zipDeflated(libraryZipFiles(bundles, images));
fs.writeFileSync(path.join(OUT, LIBRARY_ZIP), libZip);

// 3. the GM guide
const guide = path.join(ROOT, "ap-turm-gm-guide.pdf");
if (fs.existsSync(guide)) fs.copyFileSync(guide, path.join(OUT, "ap-turm-gm-guide.pdf"));
else warnings.push("ap-turm-gm-guide.pdf fehlt im Systemordner");

// 4. HANDOVER.txt
const text = `AP-Turm ${manifest.version} - Übergabe an die Spielleitung
${"=".repeat(44)}

Voraussetzung: Foundry VTT 13 (getestet mit ${manifest.compatibility?.verified ?? "13"}).

1. ${systemZip} nach Data/systems/ap-turm entpacken, so dass die Datei
   Data/systems/ap-turm/system.json liegt. (Windows: %LOCALAPPDATA%\\FoundryVTT\\Data\\systems\\ap-turm)
2. Foundry 13 neu starten. Unter "Game Systems" erscheint "AP-Turm".
3. Neue Welt anlegen: Game Worlds -> Create World, Game System "AP-Turm", Welt starten.
4. In der Welt: Seitenleiste Actors -> Knopf "AP-Turm" -> "Import from bundle file"
   -> ${LIBRARY_ZIP} wählen. Die Bilder landen im Data-Ordner, danach entstehen die Kompendien
   "Spells - ..." und "Monsters - ..." (dauert einige Minuten, Fortschritt oben rechts).
5. Charaktere kommen per App-JSON (Export aus der AP-App, ap_<name>.json): Spieler öffnen ihren
   eigenen Bogen und wählen in der Fensterleiste "Import JSON". Dafür braucht jeder Spieler einen
   Charakter, der ihm gehört - die Spielleitung legt ihn an (Actors -> Create Actor, Typ character,
   Besitzrecht setzen) oder importiert die Datei gleich selbst über Actors -> AP-Turm -> "Import character".

Optional: Mit den Modulen "JB2A" (Free oder Patreon) und "Sequencer" gibt es Angriffs- und
Zauberanimationen; ohne sie läuft alles gleich, nur ohne Animation.

Ausführlich: ap-turm-gm-guide.pdf (Kapitel "Libraries übernehmen" für Schritt 4).
`;
fs.writeFileSync(path.join(OUT, "HANDOVER.txt"), text.replace(/\n/g, "\r\n"), "utf8");

// report
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
console.log(`\n${LIBRARY_ZIP}: ${bundles.map(b => `${bundleFile(b.kind, b.key)} (${b.count})`).join(", ")}; ${images.length} Bilder; ${mb(libZip.length)}`);
for (const f of fs.readdirSync(OUT).sort()) console.log(`  ${f.padEnd(28)} ${mb(fs.statSync(path.join(OUT, f)).size)}`);
if (warnings.length) { console.log("\nHinweise:"); for (const w of warnings.slice(0, 30)) console.log(`  - ${w}`); if (warnings.length > 30) console.log(`  ... ${warnings.length - 30} weitere`); }
console.log(`\nÜbergabeordner: ${OUT}`);
